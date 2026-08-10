"""Hearthlist — shared household hub for groceries, meals, and chores."""

from __future__ import annotations

import os
import secrets
import sqlite3
import string
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

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
        "STRIPE_SECRET_KEY",
        "STRIPE_PUBLISHABLE_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_PRICE_MONTHLY",
        "STRIPE_PRICE_YEARLY",
    ):
        raw = os.environ.get(key)
        if raw:
            values[key] = raw.strip()

    if not values.get("SECRET_KEY"):
        values["SECRET_KEY"] = secrets.token_hex(32)
        if not IS_PRODUCTION:
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


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc: BaseException | None = None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
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
        """
    )
    db.commit()
    db.close()


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
        return render_template("login.html"), 401

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
        return render_template("forgot_password.html")

    email = (request.form.get("email") or "").strip().lower()
    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    reset_url = None
    if user:
        token = create_reset_token(user["id"])
        reset_url = public_base_url() + url_for("reset_password", token=token)
        # Until email/SMTP is configured, show the one-time link on screen
        # so you can recover access. Keep this private.
    flash(
        "If that email is registered, you can reset your password below.",
        "ok",
    )
    return render_template(
        "forgot_password.html",
        submitted=True,
        reset_url=reset_url,
        email=email,
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
    return render_template(
        "app.html",
        household=household,
        user=user,
        status=status,
        members=members,
        weekdays=WEEKDAYS,
        meal_types=MEAL_TYPES,
        week_dates=[d.isoformat() for d in week_dates()],
    )


@app.get("/account")
@login_required
@require_household
def account(household, user):
    status = plan_status(household)
    return render_template("account.html", household=household, user=user, status=status)


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
        SELECT id, meal_date, meal_type, title, notes
        FROM meal_slots
        WHERE household_id = ? AND meal_date >= ? AND meal_date <= ?
        """,
        (household["id"], dates[0], dates[-1]),
    ).fetchall()
    by_key = {(r["meal_date"], r["meal_type"]): dict(r) for r in rows}
    slots = []
    for d in dates:
        for mt in MEAL_TYPES:
            item = by_key.get((d, mt))
            slots.append(
                {
                    "date": d,
                    "meal_type": mt,
                    "title": item["title"] if item else "",
                    "notes": item["notes"] if item else "",
                    "id": item["id"] if item else None,
                }
            )
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
    try:
        date.fromisoformat(meal_date)
    except ValueError:
        return jsonify({"error": "Invalid date"}), 400
    if meal_type not in MEAL_TYPES:
        return jsonify({"error": "Invalid meal type"}), 400
    db = get_db()
    db.execute(
        """
        INSERT INTO meal_slots (household_id, meal_date, meal_type, title, notes)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(household_id, meal_date, meal_type)
        DO UPDATE SET title = excluded.title, notes = excluded.notes
        """,
        (household["id"], meal_date, meal_type, title, notes),
    )
    db.commit()
    return jsonify({"ok": True, "date": meal_date, "meal_type": meal_type, "title": title, "notes": notes})


@app.get("/api/chores")
@login_required
def api_chores_list():
    user, household, err = household_for_api()
    if err:
        return err
    rows = get_db().execute(
        """
        SELECT id, title, assignee, done, due_date, created_at
        FROM chores
        WHERE household_id = ?
        ORDER BY done ASC, id DESC
        """,
        (household["id"],),
    ).fetchall()
    return jsonify(
        {
            "items": [
                {
                    "id": r["id"],
                    "title": r["title"],
                    "assignee": r["assignee"] or "",
                    "done": bool(r["done"]),
                    "due_date": r["due_date"],
                    "created_at": r["created_at"],
                }
                for r in rows
            ]
        }
    )


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
    if not title:
        return jsonify({"error": "title required"}), 400
    if due_date:
        try:
            date.fromisoformat(due_date)
        except ValueError:
            return jsonify({"error": "Invalid due date"}), 400
    db = get_db()
    cur = db.execute(
        """
        INSERT INTO chores (household_id, title, assignee, done, due_date, created_at)
        VALUES (?, ?, ?, 0, ?, ?)
        """,
        (household["id"], title[:200], assignee, due_date, utc_now_iso()),
    )
    db.commit()
    return jsonify({"id": cur.lastrowid, "title": title, "assignee": assignee, "done": False, "due_date": due_date}), 201


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
        "SELECT * FROM chores WHERE id = ? AND household_id = ?",
        (chore_id, household["id"]),
    ).fetchone()
    if not row:
        return jsonify({"error": "Not found"}), 404
    payload = request.get_json(silent=True) or {}
    title = row["title"]
    assignee = row["assignee"]
    done = row["done"]
    due_date = row["due_date"]
    if "title" in payload:
        title = str(payload["title"]).strip()[:200]
    if "assignee" in payload:
        assignee = str(payload["assignee"]).strip()[:80]
    if "done" in payload:
        done = 1 if payload["done"] else 0
    if "due_date" in payload:
        due_date = (str(payload["due_date"]).strip() or None)
    db.execute(
        "UPDATE chores SET title = ?, assignee = ?, done = ?, due_date = ? WHERE id = ?",
        (title, assignee, done, due_date, chore_id),
    )
    db.commit()
    return jsonify({"id": chore_id, "title": title, "assignee": assignee, "done": bool(done), "due_date": due_date})


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
    secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    try:
        if secret:
            event = stripe.Webhook.construct_event(payload, sig, secret)
        else:
            event = stripe.Event.construct_from(request.get_json(force=True), stripe.api_key)
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
    if IS_PRODUCTION and os.environ.get("STRIPE_SECRET_KEY"):
        flash("Use Stripe Checkout in production.", "error")
        return redirect(url_for("account"))
    get_db().execute(
        "UPDATE households SET plan = 'active' WHERE id = ?",
        (household["id"],),
    )
    get_db().commit()
    flash("Plan marked active for testing.", "ok")
    return redirect(url_for("account"))


init_db()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5060"))
    app.run(host="0.0.0.0", port=port, debug=not IS_PRODUCTION)
