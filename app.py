"""Hearthlist — shared household hub for groceries, meals, and chores."""

from __future__ import annotations

import json
import os
import re
import secrets
import smtplib
import sqlite3
import string
from datetime import date, datetime, timedelta, timezone
from email.message import EmailMessage
from functools import wraps
from pathlib import Path
from typing import Any

from flask import (
    Flask,
    flash,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash

try:
    import stripe
except ImportError:  # pragma: no cover
    stripe = None

try:
    import libsql
except ImportError:  # pragma: no cover
    libsql = None

BASE_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
IS_PRODUCTION = bool(os.environ.get("RENDER") or os.environ.get("HEARTHLIST_PRODUCTION"))

TRIAL_DAYS = 7
FREE_MEMBER_LIMIT = 2
PAID_MEMBER_LIMIT = 6

MEAL_TYPES = ("breakfast", "lunch", "dinner")
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def ensure_env() -> dict[str, str]:
    values = load_dotenv(ENV_PATH)
    for key in (
        "SECRET_KEY",
        "DATA_DIR",
        "BASE_URL",
        "TURSO_DATABASE_URL",
        "TURSO_AUTH_TOKEN",
        "STRIPE_SECRET_KEY",
        "STRIPE_PUBLISHABLE_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_PRICE_MONTHLY",
        "STRIPE_PRICE_YEARLY",
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USER",
        "SMTP_PASSWORD",
        "SMTP_FROM",
        "SMTP_USE_TLS",
    ):
        raw = os.environ.get(key)
        if raw:
            values[key] = raw.strip()

    if not values.get("SECRET_KEY"):
        values["SECRET_KEY"] = secrets.token_hex(32)
        if not IS_PRODUCTION and not ENV_PATH.exists():
            try:
                ENV_PATH.write_text(
                    f"SECRET_KEY={values['SECRET_KEY']}\nBASE_URL=http://127.0.0.1:5060\n",
                    encoding="utf-8",
                )
            except OSError:
                pass

    for key, value in values.items():
        os.environ.setdefault(key, value)
    return values


_ENV = ensure_env()


def resolve_db_path() -> Path:
    data_dir = os.environ.get("DATA_DIR")
    if data_dir:
        return Path(data_dir) / "hearthlist.db"
    return BASE_DIR / "data" / "hearthlist.db"


def use_turso() -> bool:
    url, token = _raw_turso_env()
    return bool(url and token)


def _raw_turso_env() -> tuple[str, str]:
    url = (os.environ.get("TURSO_DATABASE_URL") or "").strip().strip('"').strip("'")
    token = (os.environ.get("TURSO_AUTH_TOKEN") or "").strip().strip('"').strip("'")
    return url, token


_JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")


def turso_credentials() -> tuple[str, str]:
    """Return cleaned Turso URL + JWT, or raise a clear config error."""
    url, token = _raw_turso_env()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    match = _JWT_RE.search(token.replace("\n", "").replace("\r", "").replace(" ", ""))
    if match:
        token = match.group(0)
    if "://" in token or token.startswith("libsql"):
        raise RuntimeError(
            "TURSO_AUTH_TOKEN looks like a database URL. "
            "Use libsql://… for TURSO_DATABASE_URL and the eyJ… token for TURSO_AUTH_TOKEN."
        )
    if not token.startswith("eyJ") or token.count(".") < 2:
        raise RuntimeError(
            "TURSO_AUTH_TOKEN must be the JWT that starts with eyJ. "
            "Delete it in Render, re-add, and paste only the token (no spaces or labels)."
        )
    if not url.startswith(("libsql://", "https://")):
        # Tolerate accidental paste of "URL=libsql://..."
        url_match = re.search(r"(?:libsql|https)://[^\s\"']+", url)
        if url_match:
            url = url_match.group(0)
        else:
            raise RuntimeError(
                "TURSO_DATABASE_URL must start with libsql:// (from the Turso dashboard)."
            )
    # Remote HTTP form is more reliable on PaaS hosts
    if url.startswith("libsql://"):
        url = "https://" + url[len("libsql://") :]
    return url, token


DB_PATH = resolve_db_path()
app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY") or _ENV["SECRET_KEY"]
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=IS_PRODUCTION,
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 30,
)

if stripe and os.environ.get("STRIPE_SECRET_KEY"):
    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().isoformat(timespec="seconds").replace("+00:00", "Z")


class DbRow:
    """sqlite3.Row-like access for drivers that only return tuples (libsql)."""

    __slots__ = ("_keys", "_values", "_map")

    def __init__(self, keys: list[str], values: tuple[Any, ...]):
        self._keys = keys
        self._values = values
        self._map = dict(zip(keys, values))

    def __getitem__(self, key: str | int) -> Any:
        if isinstance(key, int):
            return self._values[key]
        return self._map[key]

    def __iter__(self):
        return iter(self._values)

    def keys(self):
        return self._keys


class DbCursor:
    def __init__(self, cursor: Any):
        self._cursor = cursor
        self.lastrowid = getattr(cursor, "lastrowid", None)

    def _keys(self) -> list[str]:
        desc = getattr(self._cursor, "description", None) or ()
        # libsql/Turso may return identifiers uppercased (e.g. PLAN); normalize
        # so row["plan"] matches sqlite3.Row behavior on local SQLite.
        return [col[0].lower() if isinstance(col[0], str) else col[0] for col in desc]

    def _wrap(self, row: Any) -> DbRow | None:
        if row is None:
            return None
        if isinstance(row, sqlite3.Row):
            return row  # type: ignore[return-value]
        keys = self._keys()
        if isinstance(row, dict):
            return DbRow(list(row.keys()), tuple(row.values()))
        return DbRow(keys, tuple(row))

    def fetchone(self) -> DbRow | None:
        return self._wrap(self._cursor.fetchone())

    def fetchall(self) -> list[DbRow]:
        return [self._wrap(r) for r in self._cursor.fetchall() if r is not None]  # type: ignore[misc]

    def __iter__(self):
        for row in self._cursor:
            wrapped = self._wrap(row)
            if wrapped is not None:
                yield wrapped


class DbConn:
    def __init__(self, conn: Any, *, remote: bool = False):
        self._conn = conn
        self.remote = remote

    def execute(self, sql: str, params: Any = ()) -> DbCursor:
        if params == ():
            cur = self._conn.execute(sql)
        else:
            cur = self._conn.execute(sql, params)
        return DbCursor(cur)

    def executescript(self, sql: str) -> None:
        if hasattr(self._conn, "executescript"):
            self._conn.executescript(sql)
            return
        for stmt in sql.split(";"):
            chunk = stmt.strip()
            if chunk:
                self._conn.execute(chunk)

    def commit(self) -> None:
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()


def connect_db() -> DbConn | sqlite3.Connection:
    if use_turso():
        if libsql is None:
            raise RuntimeError("TURSO_* is set but the libsql package is not installed")
        url, token = turso_credentials()
        raw = libsql.connect(url, auth_token=token)
        return DbConn(raw, remote=True)

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


_db_ready = False


def ensure_db() -> None:
    """Create schema once per process; never block app import/boot."""
    global _db_ready
    if _db_ready:
        return
    init_db()
    _db_ready = True


def get_db():
    ensure_db()
    if "db" not in g:
        g.db = connect_db()
    return g.db


@app.teardown_appcontext
def close_db(_exc: BaseException | None = None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    db = connect_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS households (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            invite_code TEXT NOT NULL UNIQUE,
            owner_id INTEGER NOT NULL,
            trial_ends_at TEXT NOT NULL,
            plan TEXT NOT NULL DEFAULT 'trial',
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(owner_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS memberships (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            household_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            joined_at TEXT NOT NULL,
            UNIQUE(household_id, user_id),
            FOREIGN KEY(household_id) REFERENCES households(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS grocery_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            household_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_by INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY(household_id) REFERENCES households(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS meal_slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            household_id INTEGER NOT NULL,
            meal_date TEXT NOT NULL,
            meal_type TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            recipe_url TEXT NOT NULL DEFAULT '',
            ingredients TEXT NOT NULL DEFAULT '[]',
            UNIQUE(household_id, meal_date, meal_type),
            FOREIGN KEY(household_id) REFERENCES households(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS chores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            household_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            assignee TEXT NOT NULL DEFAULT '',
            done INTEGER NOT NULL DEFAULT 0,
            due_date TEXT,
            recurrence TEXT NOT NULL DEFAULT 'none',
            recurrence_weekday INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY(household_id) REFERENCES households(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            household_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            weekday INTEGER NOT NULL,
            notify_time TEXT NOT NULL DEFAULT '07:00',
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY(household_id) REFERENCES households(id) ON DELETE CASCADE
        );
        """
    )
    # Migrations for older local/prod DBs
    chore_cols = {
        str(row[1]).lower() for row in db.execute("PRAGMA table_info(chores)").fetchall()
    }
    if "recurrence" not in chore_cols:
        db.execute("ALTER TABLE chores ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none'")
    if "recurrence_weekday" not in chore_cols:
        db.execute("ALTER TABLE chores ADD COLUMN recurrence_weekday INTEGER")
    meal_cols = {
        str(row[1]).lower() for row in db.execute("PRAGMA table_info(meal_slots)").fetchall()
    }
    if "recipe_url" not in meal_cols:
        db.execute("ALTER TABLE meal_slots ADD COLUMN recipe_url TEXT NOT NULL DEFAULT ''")
    if "ingredients" not in meal_cols:
        db.execute("ALTER TABLE meal_slots ADD COLUMN ingredients TEXT NOT NULL DEFAULT '[]'")
    db.commit()
    db.close()


def parse_ingredients(raw: Any) -> list[dict[str, str]]:
    """Normalize meal ingredients to [{name, qty}, ...]."""
    items: list[Any]
    if raw is None or raw == "":
        items = []
    elif isinstance(raw, list):
        items = raw
    elif isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            items = parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            items = []
    else:
        items = []

    cleaned: list[dict[str, str]] = []
    for item in items:
        if isinstance(item, str):
            name = item.strip()[:120]
            qty = ""
        elif isinstance(item, dict):
            name = str(item.get("name") or "").strip()[:120]
            qty = str(item.get("qty") or "").strip()[:40]
        else:
            continue
        if name:
            cleaned.append({"name": name, "qty": qty})
    return cleaned[:40]


def ingredients_json(items: list[dict[str, str]]) -> str:
    return json.dumps(items, ensure_ascii=False)


def meal_slot_payload(item: Any | None, meal_date: str, meal_type: str) -> dict[str, Any]:
    if not item:
        return {
            "date": meal_date,
            "meal_type": meal_type,
            "title": "",
            "notes": "",
            "recipe_url": "",
            "ingredients": [],
            "id": None,
        }
    keys = set(item.keys()) if hasattr(item, "keys") else set()
    recipe_url = item["recipe_url"] if "recipe_url" in keys and item["recipe_url"] else ""
    ingredients_raw = item["ingredients"] if "ingredients" in keys else "[]"
    return {
        "date": meal_date,
        "meal_type": meal_type,
        "title": item["title"] or "",
        "notes": item["notes"] or "",
        "recipe_url": recipe_url or "",
        "ingredients": parse_ingredients(ingredients_raw),
        "id": item["id"],
    }


def next_chore_due(recurrence: str, weekday: int | None, from_day: date | None = None) -> str | None:
    """Return next ISO due date after completing a recurring chore."""
    base = from_day or date.today()
    if recurrence == "daily":
        return (base + timedelta(days=1)).isoformat()
    if recurrence == "weekly":
        target = 0 if weekday is None else int(weekday)
        days_ahead = (target - base.weekday()) % 7
        if days_ahead == 0:
            days_ahead = 7
        return (base + timedelta(days=days_ahead)).isoformat()
    if recurrence == "monthly":
        year = base.year
        month = base.month + 1
        if month > 12:
            month = 1
            year += 1
        day = base.day
        # Clamp to last day of next month
        if month == 12:
            last = date(year + 1, 1, 1) - timedelta(days=1)
        else:
            last = date(year, month + 1, 1) - timedelta(days=1)
        day = min(day, last.day)
        return date(year, month, day).isoformat()
    return None


def chore_row(r: Any) -> dict:
    keys = r.keys()
    return {
        "id": r["id"],
        "title": r["title"],
        "assignee": r["assignee"] or "",
        "done": bool(r["done"]),
        "due_date": r["due_date"],
        "recurrence": r["recurrence"] if "recurrence" in keys and r["recurrence"] else "none",
        "recurrence_weekday": (
            int(r["recurrence_weekday"])
            if "recurrence_weekday" in keys and r["recurrence_weekday"] is not None
            else None
        ),
        "created_at": r["created_at"],
    }


def public_base_url() -> str:
    return (os.environ.get("BASE_URL") or request.url_root).rstrip("/")


def create_reset_token(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (utc_now() + timedelta(hours=1)).isoformat(timespec="seconds").replace("+00:00", "Z")
    db = get_db()
    db.execute(
        "UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0",
        (user_id,),
    )
    db.execute(
        """
        INSERT INTO password_reset_tokens (user_id, token, expires_at, used, created_at)
        VALUES (?, ?, ?, 0, ?)
        """,
        (user_id, token, expires, utc_now_iso()),
    )
    db.commit()
    return token


def smtp_configured() -> bool:
    return bool((os.environ.get("SMTP_HOST") or "").strip() and (os.environ.get("SMTP_FROM") or "").strip())


def send_reset_email(to_email: str, reset_url: str) -> bool:
    """Send a password-reset email when SMTP env vars are set. Returns True on success."""
    host = (os.environ.get("SMTP_HOST") or "").strip()
    from_addr = (os.environ.get("SMTP_FROM") or "").strip()
    if not host or not from_addr:
        return False
    port = int((os.environ.get("SMTP_PORT") or "587").strip() or "587")
    user = (os.environ.get("SMTP_USER") or "").strip()
    password = os.environ.get("SMTP_PASSWORD") or ""
    use_tls = (os.environ.get("SMTP_USE_TLS") or "1").strip().lower() not in ("0", "false", "no")

    msg = EmailMessage()
    msg["Subject"] = "Reset your Hearthlist password"
    msg["From"] = from_addr
    msg["To"] = to_email
    msg.set_content(
        "Use this link to set a new Hearthlist password (expires in 1 hour):\n\n"
        f"{reset_url}\n\n"
        "If you did not request this, you can ignore this email.\n"
    )

    try:
        with smtplib.SMTP(host, port, timeout=20) as smtp:
            if use_tls:
                smtp.starttls()
            if user:
                smtp.login(user, password)
            smtp.send_message(msg)
        return True
    except Exception as exc:  # pragma: no cover
        print(f"Password reset email failed: {exc}")
        return False


def deliver_reset_link(to_email: str, reset_url: str) -> bool:
    """Email the reset link when SMTP is configured. Never expose it in the browser."""
    if smtp_configured():
        return send_reset_email(to_email, reset_url)
    if not IS_PRODUCTION:
        # Local recovery only — link goes to the server console, not the page.
        print(f"[hearthlist] Password reset for {to_email}: {reset_url}")
        return True
    return False


def valid_reset_token(token: str):
    row = get_db().execute(
        """
        SELECT t.*, u.email, u.name
        FROM password_reset_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.token = ? AND t.used = 0
        """,
        (token,),
    ).fetchone()
    if not row:
        return None
    expires = parse_iso(row["expires_at"])
    if not expires or utc_now() > expires:
        return None
    return row


def invite_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(8))


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def user_household(user_id: int):
    return get_db().execute(
        """
        SELECT h.*
        FROM households h
        JOIN memberships m ON m.household_id = h.id
        WHERE m.user_id = ?
        ORDER BY m.joined_at ASC
        LIMIT 1
        """,
        (user_id,),
    ).fetchone()


def member_count(household_id: int) -> int:
    row = get_db().execute(
        "SELECT COUNT(*) AS c FROM memberships WHERE household_id = ?",
        (household_id,),
    ).fetchone()
    return int(row["c"] if row else 0)


def parse_iso(dt: str | None) -> datetime | None:
    if not dt:
        return None
    try:
        return datetime.fromisoformat(dt.replace("Z", "+00:00"))
    except ValueError:
        return None


def plan_status(household) -> dict:
    plan = (household["plan"] if household else "trial") or "trial"
    trial_ends = parse_iso(household["trial_ends_at"] if household else None)
    now = utc_now()
    trial_active = bool(trial_ends and now <= trial_ends)
    subscribed = plan in ("active", "past_due") and bool(household["stripe_subscription_id"])
    # Treat explicit active plan even without stripe id (manual/test)
    if plan == "active":
        subscribed = True
    access = subscribed or trial_active
    members = member_count(household["id"]) if household else 0
    member_limit = PAID_MEMBER_LIMIT if subscribed else FREE_MEMBER_LIMIT
    return {
        "plan": plan,
        "trial_active": trial_active,
        "trial_ends_at": household["trial_ends_at"] if household else None,
        "subscribed": subscribed,
        "access": access,
        "member_count": members,
        "member_limit": member_limit,
        "can_invite": access and members < member_limit,
        "stripe_ready": bool(os.environ.get("STRIPE_SECRET_KEY") and os.environ.get("STRIPE_PRICE_MONTHLY")),
    }


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user():
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized"}), 401
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def require_household(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if not user:
            return redirect(url_for("login"))
        household = user_household(user["id"])
        if not household:
            flash("Create or join a household to continue.", "error")
            return redirect(url_for("onboarding"))
        return view(*args, household=household, user=user, **kwargs)

    return wrapped


def week_dates(anchor: date | None = None) -> list[date]:
    today = anchor or date.today()
    start = today - timedelta(days=today.weekday())  # Monday
    return [start + timedelta(days=i) for i in range(7)]


@app.context_processor
def inject_globals():
    user = current_user()
    household = user_household(user["id"]) if user else None
    return {
        "current_user": user,
        "current_household": household,
        "plan": plan_status(household) if household else None,
        "stripe_pk": os.environ.get("STRIPE_PUBLISHABLE_KEY", ""),
    }


# ---------- Pages ----------


@app.get("/")
def landing():
    if current_user():
        return redirect(url_for("home"))
    return render_template("landing.html")


@app.route("/signup", methods=["GET", "POST"])
def signup():
    if current_user():
        return redirect(url_for("home"))
    if request.method == "GET":
        return render_template("signup.html")

    email = (request.form.get("email") or "").strip().lower()
    name = (request.form.get("name") or "").strip()
    password = request.form.get("password") or ""
    household_name = (request.form.get("household_name") or "").strip() or "Our home"

    if not email or not name or len(password) < 6:
        flash("Please fill all fields. Password must be at least 6 characters.", "error")
        return render_template("signup.html"), 400

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        flash("That email is already registered. Try signing in.", "error")
        return render_template("signup.html"), 400

    now = utc_now_iso()
    cur = db.execute(
        "INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (email, name, generate_password_hash(password), now),
    )
    user_id = cur.lastrowid
    code = invite_code()
    trial_end = (utc_now() + timedelta(days=TRIAL_DAYS)).isoformat(timespec="seconds").replace("+00:00", "Z")
    hcur = db.execute(
        """
        INSERT INTO households (name, invite_code, owner_id, trial_ends_at, plan, created_at)
        VALUES (?, ?, ?, ?, 'trial', ?)
        """,
        (household_name, code, user_id, trial_end, now),
    )
    db.execute(
        "INSERT INTO memberships (household_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
        (hcur.lastrowid, user_id, now),
    )
    db.commit()
    session.clear()
    session["user_id"] = user_id
    session.permanent = True
    flash("Welcome to Hearthlist — your 7-day trial has started.", "ok")
    return redirect(url_for("home"))


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user():
        return redirect(url_for("home"))
    if request.method == "GET":
        return render_template("login.html")

    email = (request.form.get("email") or "").strip().lower()
    password = request.form.get("password") or ""
    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        flash("Incorrect email or password.", "error")
        return (
            render_template(
                "login.html",
                email=email,
                login_error="Incorrect email or password. Try again, or use Forgot password.",
            ),
            401,
        )

    session.clear()
    session["user_id"] = user["id"]
    session.permanent = True
    nxt = request.args.get("next") or url_for("home")
    if not nxt.startswith("/") or nxt.startswith("//"):
        nxt = url_for("home")
    return redirect(nxt)


@app.route("/forgot-password", methods=["GET", "POST"])
def forgot_password():
    if current_user():
        return redirect(url_for("home"))
    if request.method == "GET":
        return render_template("forgot_password.html", email_ready=smtp_configured())

    email = (request.form.get("email") or "").strip().lower()
    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    # Same response whether or not the email exists (no account enumeration).
    # Only mint a token when it can be delivered (SMTP) or logged locally (dev).
    if user and (smtp_configured() or not IS_PRODUCTION):
        token = create_reset_token(user["id"])
        reset_url = public_base_url() + url_for("reset_password", token=token)
        deliver_reset_link(user["email"], reset_url)

    flash(
        "If that email is registered, check your inbox for a reset link. "
        "It may take a minute to arrive.",
        "ok",
    )
    return render_template(
        "forgot_password.html",
        submitted=True,
        email=email,
        email_ready=smtp_configured(),
    )


@app.route("/reset-password/<token>", methods=["GET", "POST"])
def reset_password(token: str):
    if current_user():
        return redirect(url_for("home"))
    row = valid_reset_token(token)
    if not row:
        flash("That reset link is invalid or expired. Request a new one.", "error")
        return redirect(url_for("forgot_password"))

    if request.method == "GET":
        return render_template("reset_password.html", token=token, email=row["email"])

    password = request.form.get("password") or ""
    confirm = request.form.get("confirm") or ""
    if len(password) < 6:
        flash("Password must be at least 6 characters.", "error")
        return render_template("reset_password.html", token=token, email=row["email"]), 400
    if password != confirm:
        flash("Passwords do not match.", "error")
        return render_template("reset_password.html", token=token, email=row["email"]), 400

    db = get_db()
    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (generate_password_hash(password), row["user_id"]),
    )
    db.execute(
        "UPDATE password_reset_tokens SET used = 1 WHERE id = ?",
        (row["id"],),
    )
    db.commit()
    flash("Password updated. Sign in with your new password.", "ok")
    return redirect(url_for("login"))


@app.get("/logout")
def logout():
    session.clear()
    return redirect(url_for("landing"))


@app.route("/onboarding", methods=["GET", "POST"])
@login_required
def onboarding():
    user = current_user()
    if user_household(user["id"]):
        return redirect(url_for("home"))

    if request.method == "POST":
        action = request.form.get("action")
        db = get_db()
        now = utc_now_iso()
        if action == "create":
            name = (request.form.get("household_name") or "").strip() or "Our home"
            code = invite_code()
            trial_end = (utc_now() + timedelta(days=TRIAL_DAYS)).isoformat(timespec="seconds").replace("+00:00", "Z")
            hcur = db.execute(
                """
                INSERT INTO households (name, invite_code, owner_id, trial_ends_at, plan, created_at)
                VALUES (?, ?, ?, ?, 'trial', ?)
                """,
                (name, code, user["id"], trial_end, now),
            )
            db.execute(
                "INSERT INTO memberships (household_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
                (hcur.lastrowid, user["id"], now),
            )
            db.commit()
            return redirect(url_for("home"))
        if action == "join":
            code = (request.form.get("invite_code") or "").strip().upper()
            household = db.execute(
                "SELECT * FROM households WHERE invite_code = ?", (code,)
            ).fetchone()
            if not household:
                flash("Invite code not found.", "error")
                return render_template("onboarding.html")
            status = plan_status(household)
            if not status["can_invite"]:
                flash("This household can’t add more members on its current plan.", "error")
                return render_template("onboarding.html")
            db.execute(
                "INSERT OR IGNORE INTO memberships (household_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
                (household["id"], user["id"], now),
            )
            db.commit()
            return redirect(url_for("home"))

    return render_template("onboarding.html")


@app.get("/app")
@login_required
@require_household
def home(household, user):
    status = plan_status(household)
    members = get_db().execute(
        """
        SELECT u.id, u.name, u.email, m.role
        FROM memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.household_id = ?
        ORDER BY m.joined_at ASC
        """,
        (household["id"],),
    ).fetchall()
    invite_url = public_base_url() + url_for("join_link", code=household["invite_code"])
    return render_template(
        "app.html",
        household=household,
        user=user,
        status=status,
        members=members,
        weekdays=WEEKDAYS,
        meal_types=MEAL_TYPES,
        week_dates=[d.isoformat() for d in week_dates()],
        invite_url=invite_url,
    )


@app.get("/account")
@login_required
@require_household
def account(household, user):
    status = plan_status(household)
    return render_template("account.html", household=household, user=user, status=status)


@app.post("/account/household-name")
@login_required
@require_household
def rename_household(household, user):
    name = (request.form.get("household_name") or "").strip()
    if not name:
        flash("Household name can’t be empty.", "error")
        return redirect(url_for("account"))
    if len(name) > 80:
        flash("Keep the household name under 80 characters.", "error")
        return redirect(url_for("account"))
    get_db().execute(
        "UPDATE households SET name = ? WHERE id = ?",
        (name, household["id"]),
    )
    get_db().commit()
    flash("Household name updated.", "ok")
    return redirect(url_for("account"))


@app.post("/account/password")
@login_required
@require_household
def change_password(household, user):
    current = request.form.get("current_password") or ""
    new_password = request.form.get("new_password") or ""
    confirm = request.form.get("confirm_password") or ""
    if not check_password_hash(user["password_hash"], current):
        flash("Current password is incorrect.", "error")
        return redirect(url_for("account"))
    if len(new_password) < 6:
        flash("New password must be at least 6 characters.", "error")
        return redirect(url_for("account"))
    if new_password != confirm:
        flash("New passwords do not match.", "error")
        return redirect(url_for("account"))
    get_db().execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (generate_password_hash(new_password), user["id"]),
    )
    get_db().commit()
    flash("Password changed.", "ok")
    return redirect(url_for("account"))


@app.get("/join/<code>")
def join_link(code: str):
    session["pending_invite"] = code.strip().upper()
    if current_user():
        return redirect(url_for("join_redeem"))
    flash("Create an account or sign in to join this household.", "ok")
    return redirect(url_for("signup"))


@app.route("/join", methods=["GET", "POST"])
@login_required
def join_redeem():
    user = current_user()
    existing = user_household(user["id"])
    code = (request.form.get("invite_code") if request.method == "POST" else None) or session.get("pending_invite") or ""
    code = code.strip().upper()

    if request.method == "GET" and not code:
        return render_template("join.html", code="")

    if not code:
        flash("Enter an invite code.", "error")
        return render_template("join.html", code="")

    db = get_db()
    household = db.execute("SELECT * FROM households WHERE invite_code = ?", (code,)).fetchone()
    if not household:
        flash("Invite code not found.", "error")
        return render_template("join.html", code=code)

    if existing and existing["id"] != household["id"]:
        flash("You’re already in a household. Leave that one before joining another (v1 supports one).", "error")
        return redirect(url_for("home"))

    status = plan_status(household)
    if existing and existing["id"] == household["id"]:
        session.pop("pending_invite", None)
        return redirect(url_for("home"))

    if not status["can_invite"] and not existing:
        flash("This household is full on its current plan.", "error")
        return render_template("join.html", code=code)

    if request.method == "POST" or session.get("pending_invite"):
        db.execute(
            "INSERT OR IGNORE INTO memberships (household_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
            (household["id"], user["id"], utc_now_iso()),
        )
        db.commit()
        session.pop("pending_invite", None)
        flash(f"Joined {household['name']}!", "ok")
        return redirect(url_for("home"))

    return render_template("join.html", code=code, household=household)


# ---------- APIs ----------


def household_for_api():
    user = current_user()
    if not user:
        return None, None, (jsonify({"error": "Unauthorized"}), 401)
    household = user_household(user["id"])
    if not household:
        return None, None, (jsonify({"error": "No household"}), 400)
    return user, household, None


@app.get("/api/groceries")
@login_required
def api_groceries_list():
    user, household, err = household_for_api()
    if err:
        return err
    rows = get_db().execute(
        """
        SELECT id, title, done, sort_order, created_at
        FROM grocery_items
        WHERE household_id = ?
        ORDER BY done ASC, sort_order ASC, id ASC
        """,
        (household["id"],),
    ).fetchall()
    return jsonify(
        {
            "items": [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "done": bool(r["done"]),
                    "sort_order": r["sort_order"],
                    "created_at": r["created_at"],
                }
                for r in rows
            ]
        }
    )


@app.post("/api/groceries")
@login_required
def api_groceries_create():
    user, household, err = household_for_api()
    if err:
        return err
    if not plan_status(household)["access"]:
        return jsonify({"error": "Trial ended. Subscribe to keep editing."}), 402
    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title required"}), 400
    if len(title) > 200:
        return jsonify({"error": "title too long"}), 400
    db = get_db()
    max_order = db.execute(
        "SELECT COALESCE(MAX(sort_order), -1) FROM grocery_items WHERE household_id = ?",
        (household["id"],),
    ).fetchone()[0]
    cur = db.execute(
        """
        INSERT INTO grocery_items (household_id, title, done, sort_order, created_by, created_at)
        VALUES (?, ?, 0, ?, ?, ?)
        """,
        (household["id"], title, int(max_order) + 1, user["id"], utc_now_iso()),
    )
    db.commit()
    row = db.execute("SELECT * FROM grocery_items WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"id": row["id"], "title": row["title"], "done": False}), 201


@app.patch("/api/groceries/<int:item_id>")
@login_required
def api_groceries_update(item_id: int):
    user, household, err = household_for_api()
    if err:
        return err
    if not plan_status(household)["access"]:
        return jsonify({"error": "Trial ended. Subscribe to keep editing."}), 402
    db = get_db()
    row = db.execute(
        "SELECT * FROM grocery_items WHERE id = ? AND household_id = ?",
        (item_id, household["id"]),
    ).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    payload = request.get_json(silent=True) or {}
    title = row["title"]
    done = row["done"]
    if "title" in payload:
        title = str(payload["title"]).strip()
        if not title:
            return jsonify({"error": "title required"}), 400
    if "done" in payload:
        done = 1 if payload["done"] else 0
    db.execute(
        "UPDATE grocery_items SET title = ?, done = ? WHERE id = ?",
        (title, done, item_id),
    )
    db.commit()
    return jsonify({"id": item_id, "title": title, "done": bool(done)})


@app.delete("/api/groceries/<int:item_id>")
@login_required
def api_groceries_delete(item_id: int):
    user, household, err = household_for_api()
    if err:
        return err
    db = get_db()
    db.execute(
        "DELETE FROM grocery_items WHERE id = ? AND household_id = ?",
        (item_id, household["id"]),
    )
    db.commit()
    return jsonify({"ok": True})


@app.get("/api/meals")
@login_required
def api_meals_list():
    user, household, err = household_for_api()
    if err:
        return err
    dates = [d.isoformat() for d in week_dates()]
    rows = get_db().execute(
        """
        SELECT id, meal_date, meal_type, title, notes, recipe_url, ingredients
        FROM meal_slots
        WHERE household_id = ? AND meal_date >= ? AND meal_date <= ?
        """,
        (household["id"], dates[0], dates[-1]),
    ).fetchall()
    by_key = {(r["meal_date"], r["meal_type"]): r for r in rows}
    slots = []
    for d in dates:
        for mt in MEAL_TYPES:
            slots.append(meal_slot_payload(by_key.get((d, mt)), d, mt))
    return jsonify({"week": dates, "slots": slots})


@app.put("/api/meals")
@login_required
def api_meals_upsert():
    user, household, err = household_for_api()
    if err:
        return err
    if not plan_status(household)["access"]:
        return jsonify({"error": "Trial ended. Subscribe to keep editing."}), 402
    payload = request.get_json(silent=True) or {}
    meal_date = (payload.get("date") or "").strip()
    meal_type = (payload.get("meal_type") or "").strip()
    title = (payload.get("title") or "").strip()[:200]
    notes = (payload.get("notes") or "").strip()[:1000]
    recipe_url = (payload.get("recipe_url") or "").strip()[:500]
    ingredients = parse_ingredients(payload.get("ingredients"))
    if recipe_url and not recipe_url.startswith(("http://", "https://")):
        recipe_url = "https://" + recipe_url
    try:
        date.fromisoformat(meal_date)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400
    if meal_type not in MEAL_TYPES:
        return jsonify({"error": "Invalid meal type"}), 400
    db = get_db()
    db.execute(
        """
        INSERT INTO meal_slots (
            household_id, meal_date, meal_type, title, notes, recipe_url, ingredients
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(household_id, meal_date, meal_type)
        DO UPDATE SET
            title = excluded.title,
            notes = excluded.notes,
            recipe_url = excluded.recipe_url,
            ingredients = excluded.ingredients
        """,
        (
            household["id"],
            meal_date,
            meal_type,
            title,
            notes,
            recipe_url,
            ingredients_json(ingredients),
        ),
    )
    db.commit()
    return jsonify(
        {
            "ok": True,
            "date": meal_date,
            "meal_type": meal_type,
            "title": title,
            "notes": notes,
            "recipe_url": recipe_url,
            "ingredients": ingredients,
        }
    )


@app.post("/api/meals/to-groceries")
@login_required
def api_meals_to_groceries():
    user, household, err = household_for_api()
    if err:
        return err
    if not plan_status(household)["access"]:
        return jsonify({"error": "Trial ended. Subscribe to keep editing."}), 402
    payload = request.get_json(silent=True) or {}
    names = payload.get("names") or []
    if not isinstance(names, list):
        return jsonify({"error": "names must be a list"}), 400

    cleaned: list[str] = []
    for name in names:
        title = str(name or "").strip()[:200]
        if title and title.lower() not in {t.lower() for t in cleaned}:
            cleaned.append(title)
    if not cleaned:
        return jsonify({"error": "Pick at least one ingredient"}), 400

    db = get_db()
    existing_rows = db.execute(
        """
        SELECT title FROM grocery_items
        WHERE household_id = ? AND done = 0
        """,
        (household["id"],),
    ).fetchall()
    existing = {str(r["title"]).strip().lower() for r in existing_rows}

    max_order = db.execute(
        "SELECT COALESCE(MAX(sort_order), -1) FROM grocery_items WHERE household_id = ?",
        (household["id"],),
    ).fetchone()[0]
    next_order = int(max_order) + 1
    added: list[str] = []
    skipped: list[str] = []
    now = utc_now_iso()
    for title in cleaned:
        if title.lower() in existing:
            skipped.append(title)
            continue
        db.execute(
            """
            INSERT INTO grocery_items (household_id, title, done, sort_order, created_by, created_at)
            VALUES (?, ?, 0, ?, ?, ?)
            """,
            (household["id"], title, next_order, user["id"], now),
        )
        existing.add(title.lower())
        added.append(title)
        next_order += 1
    db.commit()
    return jsonify({"ok": True, "added": added, "skipped": skipped})


@app.get("/api/chores")
@login_required
def api_chores_list():
    user, household, err = household_for_api()
    if err:
        return err
    rows = get_db().execute(
        """
        SELECT id, title, assignee, done, due_date, recurrence, recurrence_weekday, created_at
        FROM chores
        WHERE household_id = ?
        ORDER BY done ASC, id DESC
        """,
        (household["id"],),
    ).fetchall()
    return jsonify({"items": [chore_row(r) for r in rows]})


@app.post("/api/chores")
@login_required
def api_chores_create():
    user, household, err = household_for_api()
    if err:
        return err
    if not plan_status(household)["access"]:
        return jsonify({"error": "Trial ended. Subscribe to keep editing."}), 402
    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip()
    assignee = (payload.get("assignee") or "").strip()[:80]
    due_date = (payload.get("due_date") or "").strip() or None
    recurrence = (payload.get("recurrence") or "none").strip().lower()
    if recurrence not in ("none", "daily", "weekly", "monthly"):
        return jsonify({"error": "recurrence must be none, daily, weekly, or monthly"}), 400
    recurrence_weekday = payload.get("recurrence_weekday")
    if recurrence == "weekly":
        try:
            recurrence_weekday = int(recurrence_weekday)
        except (TypeError, ValueError):
            recurrence_weekday = date.today().weekday()
        if recurrence_weekday < 0 or recurrence_weekday > 6:
            return jsonify({"error": "recurrence_weekday must be 0–6"}), 400
    else:
        recurrence_weekday = None
    if not title:
        return jsonify({"error": "title required"}), 400
    if due_date:
        try:
            date.fromisoformat(due_date)
        except ValueError:
            return jsonify({"error": "Invalid due date"}), 400
    elif recurrence in ("daily", "weekly", "monthly"):
        due_date = date.today().isoformat()
        if recurrence == "weekly":
            # Align first due date to chosen weekday
            due_date = next_chore_due("weekly", recurrence_weekday, date.today() - timedelta(days=1))

    db = get_db()
    cur = db.execute(
        """
        INSERT INTO chores (
            household_id, title, assignee, done, due_date, recurrence, recurrence_weekday, created_at
        )
        VALUES (?, ?, ?, 0, ?, ?, ?, ?)
        """,
        (
            household["id"],
            title[:200],
            assignee,
            due_date,
            recurrence,
            recurrence_weekday,
            utc_now_iso(),
        ),
    )
    db.commit()
    row = db.execute(
        "SELECT id, title, assignee, done, due_date, recurrence, recurrence_weekday, created_at FROM chores WHERE id = ?",
        (cur.lastrowid,),
    ).fetchone()
    return jsonify(chore_row(row)), 201


@app.patch("/api/chores/<int:chore_id>")
@login_required
def api_chores_update(chore_id: int):
    user, household, err = household_for_api()
    if err:
        return err
    if not plan_status(household)["access"]:
        return jsonify({"error": "Trial ended. Subscribe to keep editing."}), 402
    db = get_db()
    row = db.execute(
        """
        SELECT id, title, assignee, done, due_date, recurrence, recurrence_weekday, created_at
        FROM chores WHERE id = ? AND household_id = ?
        """,
        (chore_id, household["id"]),
    ).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    payload = request.get_json(silent=True) or {}
    title = row["title"]
    assignee = row["assignee"]
    done = row["done"]
    due_date = row["due_date"]
    recurrence = row["recurrence"] if "recurrence" in row.keys() and row["recurrence"] else "none"
    recurrence_weekday = (
        int(row["recurrence_weekday"])
        if "recurrence_weekday" in row.keys() and row["recurrence_weekday"] is not None
        else None
    )

    if "title" in payload:
        title = str(payload["title"]).strip()[:200]
    if "assignee" in payload:
        assignee = str(payload["assignee"]).strip()[:80]
    if "due_date" in payload:
        due_date = str(payload["due_date"]).strip() or None
    if "recurrence" in payload:
        recurrence = str(payload["recurrence"]).strip().lower()
        if recurrence not in ("none", "daily", "weekly", "monthly"):
            return jsonify({"error": "invalid recurrence"}), 400
    if "recurrence_weekday" in payload and payload["recurrence_weekday"] is not None:
        try:
            recurrence_weekday = int(payload["recurrence_weekday"])
        except (TypeError, ValueError):
            return jsonify({"error": "invalid recurrence_weekday"}), 400

    if "done" in payload:
        marking_done = bool(payload["done"])
        if marking_done and recurrence in ("daily", "weekly", "monthly"):
            # Recurring: roll forward instead of staying checked forever
            done = 0
            due_date = next_chore_due(recurrence, recurrence_weekday, date.today())
        else:
            done = 1 if marking_done else 0

    db.execute(
        """
        UPDATE chores
        SET title = ?, assignee = ?, done = ?, due_date = ?, recurrence = ?, recurrence_weekday = ?
        WHERE id = ?
        """,
        (title, assignee, done, due_date, recurrence, recurrence_weekday, chore_id),
    )
    db.commit()
    updated = db.execute(
        "SELECT id, title, assignee, done, due_date, recurrence, recurrence_weekday, created_at FROM chores WHERE id = ?",
        (chore_id,),
    ).fetchone()
    return jsonify(chore_row(updated))


@app.delete("/api/chores/<int:chore_id>")
@login_required
def api_chores_delete(chore_id: int):
    user, household, err = household_for_api()
    if err:
        return err
    get_db().execute(
        "DELETE FROM chores WHERE id = ? AND household_id = ?",
        (chore_id, household["id"]),
    )
    get_db().commit()
    return jsonify({"ok": True})


@app.get("/api/reminders")
@login_required
def api_reminders_list():
    user, household, err = household_for_api()
    if err:
        return err
    rows = get_db().execute(
        """
        SELECT id, title, weekday, notify_time, enabled, created_at
        FROM reminders
        WHERE household_id = ?
        ORDER BY weekday ASC, notify_time ASC, id ASC
        """,
        (household["id"],),
    ).fetchall()
    today = date.today().weekday()  # Mon=0
    return jsonify(
        {
            "today_weekday": today,
            "items": [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "weekday": int(r["weekday"]),
                    "notify_time": r["notify_time"] or "07:00",
                    "enabled": bool(r["enabled"]),
                    "created_at": r["created_at"],
                    "is_today": int(r["weekday"]) == today and bool(r["enabled"]),
                }
                for r in rows
            ],
        }
    )


@app.post("/api/reminders")
@login_required
def api_reminders_create():
    user, household, err = household_for_api()
    if err:
        return err
    if not plan_status(household)["access"]:
        return jsonify({"error": "Trial ended. Subscribe to keep editing."}), 402
    payload = request.get_json(silent=True) or {}
    title = (payload.get("title") or "").strip()[:200]
    try:
        weekday = int(payload.get("weekday"))
    except (TypeError, ValueError):
        return jsonify({"error": "weekday required (0=Mon … 6=Sun)"}), 400
    if weekday < 0 or weekday > 6:
        return jsonify({"error": "weekday must be 0–6"}), 400
    notify_time = (payload.get("notify_time") or "07:00").strip()
    try:
        hour_s, minute_s = notify_time.split(":", 1)
        hour, minute = int(hour_s), int(minute_s)
        if hour < 0 or hour > 23 or minute < 0 or minute > 59:
            raise ValueError
        notify_time = f"{hour:02d}:{minute:02d}"
    except ValueError:
        return jsonify({"error": "notify_time must be HH:MM"}), 400
    if not title:
        return jsonify({"error": "title required"}), 400
    db = get_db()
    cur = db.execute(
        """
        INSERT INTO reminders (household_id, title, weekday, notify_time, enabled, created_at)
        VALUES (?, ?, ?, ?, 1, ?)
        """,
        (household["id"], title, weekday, notify_time, utc_now_iso()),
    )
    db.commit()
    return jsonify(
        {
            "id": cur.lastrowid,
            "title": title,
            "weekday": weekday,
            "notify_time": notify_time,
            "enabled": True,
        }
    ), 201


@app.patch("/api/reminders/<int:reminder_id>")
@login_required
def api_reminders_update(reminder_id: int):
    user, household, err = household_for_api()
    if err:
        return err
    if not plan_status(household)["access"]:
        return jsonify({"error": "Trial ended. Subscribe to keep editing."}), 402
    db = get_db()
    row = db.execute(
        "SELECT * FROM reminders WHERE id = ? AND household_id = ?",
        (reminder_id, household["id"]),
    ).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    payload = request.get_json(silent=True) or {}
    title = row["title"]
    weekday = int(row["weekday"])
    notify_time = row["notify_time"] or "07:00"
    enabled = row["enabled"]
    if "title" in payload:
        title = str(payload["title"]).strip()[:200]
        if not title:
            return jsonify({"error": "title required"}), 400
    if "weekday" in payload:
        try:
            weekday = int(payload["weekday"])
        except (TypeError, ValueError):
            return jsonify({"error": "invalid weekday"}), 400
        if weekday < 0 or weekday > 6:
            return jsonify({"error": "weekday must be 0–6"}), 400
    if "notify_time" in payload:
        notify_time = str(payload["notify_time"]).strip()
        try:
            hour_s, minute_s = notify_time.split(":", 1)
            hour, minute = int(hour_s), int(minute_s)
            if hour < 0 or hour > 23 or minute < 0 or minute > 59:
                raise ValueError
            notify_time = f"{hour:02d}:{minute:02d}"
        except ValueError:
            return jsonify({"error": "notify_time must be HH:MM"}), 400
    if "enabled" in payload:
        enabled = 1 if payload["enabled"] else 0
    db.execute(
        """
        UPDATE reminders
        SET title = ?, weekday = ?, notify_time = ?, enabled = ?
        WHERE id = ?
        """,
        (title, weekday, notify_time, enabled, reminder_id),
    )
    db.commit()
    return jsonify(
        {
            "id": reminder_id,
            "title": title,
            "weekday": weekday,
            "notify_time": notify_time,
            "enabled": bool(enabled),
        }
    )


@app.delete("/api/reminders/<int:reminder_id>")
@login_required
def api_reminders_delete(reminder_id: int):
    user, household, err = household_for_api()
    if err:
        return err
    get_db().execute(
        "DELETE FROM reminders WHERE id = ? AND household_id = ?",
        (reminder_id, household["id"]),
    )
    get_db().commit()
    return jsonify({"ok": True})


@app.get("/sw.js")
def service_worker():
    return app.send_static_file("sw.js"), 200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Service-Worker-Allowed": "/",
    }


# ---------- Stripe ----------


@app.post("/billing/checkout")
@login_required
@require_household
def billing_checkout(household, user):
    price = request.form.get("price") or "monthly"
    price_id = os.environ.get("STRIPE_PRICE_MONTHLY" if price == "monthly" else "STRIPE_PRICE_YEARLY")
    if not stripe or not os.environ.get("STRIPE_SECRET_KEY") or not price_id:
        flash(
            "Stripe isn’t configured yet. Add STRIPE_SECRET_KEY and STRIPE_PRICE_MONTHLY on Render to enable payments.",
            "error",
        )
        return redirect(url_for("account"))

    db = get_db()
    customer_id = household["stripe_customer_id"]
    if not customer_id:
        customer = stripe.Customer.create(email=user["email"], name=user["name"], metadata={"household_id": household["id"]})
        customer_id = customer["id"]
        db.execute(
            "UPDATE households SET stripe_customer_id = ? WHERE id = ?",
            (customer_id, household["id"]),
        )
        db.commit()

    base = (os.environ.get("BASE_URL") or request.url_root).rstrip("/")
    session_obj = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=base + url_for("account") + "?checkout=success",
        cancel_url=base + url_for("account") + "?checkout=cancel",
        metadata={"household_id": str(household["id"])},
    )
    return redirect(session_obj.url, code=303)


@app.post("/billing/portal")
@login_required
@require_household
def billing_portal(household, user):
    if not stripe or not household["stripe_customer_id"]:
        flash("No Stripe customer on file yet.", "error")
        return redirect(url_for("account"))
    base = (os.environ.get("BASE_URL") or request.url_root).rstrip("/")
    portal = stripe.billing_portal.Session.create(
        customer=household["stripe_customer_id"],
        return_url=base + url_for("account"),
    )
    return redirect(portal.url, code=303)


@app.post("/billing/webhook")
def billing_webhook():
    if not stripe:
        return jsonify({"ok": False}), 400
    payload = request.data
    sig = request.headers.get("Stripe-Signature", "")
    secret = (os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()
    if not secret:
        return jsonify({"error": "Webhook secret not configured"}), 503
    try:
        event = stripe.Webhook.construct_event(payload, sig, secret)
    except Exception:
        return jsonify({"error": "Invalid payload"}), 400

    db = get_db()
    etype = event["type"]
    data = event["data"]["object"]

    if etype == "checkout.session.completed":
        household_id = (data.get("metadata") or {}).get("household_id")
        sub_id = data.get("subscription")
        cust = data.get("customer")
        if household_id:
            db.execute(
                """
                UPDATE households
                SET plan = 'active', stripe_subscription_id = ?, stripe_customer_id = COALESCE(stripe_customer_id, ?)
                WHERE id = ?
                """,
                (sub_id, cust, int(household_id)),
            )
            db.commit()
    elif etype in ("customer.subscription.updated", "customer.subscription.deleted"):
        sub_id = data.get("id")
        status = data.get("status")
        plan = "active" if status in ("active", "trialing") else ("past_due" if status == "past_due" else "canceled")
        db.execute(
            "UPDATE households SET plan = ? WHERE stripe_subscription_id = ?",
            (plan, sub_id),
        )
        db.commit()

    return jsonify({"ok": True})


@app.post("/billing/dev-activate")
@login_required
@require_household
def billing_dev_activate(household, user):
    """Local/dev helper when Stripe keys are not set yet."""
    if IS_PRODUCTION:
        flash("Use Stripe Checkout in production.", "error")
        return redirect(url_for("account"))
    get_db().execute(
        "UPDATE households SET plan = 'active' WHERE id = ?",
        (household["id"],),
    )
    get_db().commit()
    flash("Plan marked active for testing.", "ok")
    return redirect(url_for("account"))


# Schema is created lazily on first DB use so a Turso blip can't 502 the whole site.
if not IS_PRODUCTION:
    try:
        ensure_db()
    except Exception as exc:  # pragma: no cover
        print(f"Local DB init deferred/failed: {exc}")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5060"))
    app.run(host="0.0.0.0", port=port, debug=not IS_PRODUCTION)
