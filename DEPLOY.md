# Deploy Hearthlist (free)

Same path as Daywing.

## 1) GitHub

1. Create a new repo named `Hearthlist` (empty, no README if you already have local files)
2. In GitHub Desktop: **Add existing repository** → `E:\hearthlist`
3. Publish to GitHub

## 2) Render

1. [dashboard.render.com](https://dashboard.render.com) → **New** → **Web Service**
2. Connect the `Hearthlist` GitHub repo
3. Settings:
   - **Build:** `pip install -r requirements.txt`
   - **Start:** `gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 120`
4. Environment variables:
   - `SECRET_KEY` — Generate
   - `BASE_URL` — your live URL, e.g. `https://hearthlist.onrender.com`
   - `TURSO_DATABASE_URL` — from Turso dashboard (e.g. `libsql://….turso.io`)
   - `TURSO_AUTH_TOKEN` — Turso database token
   - `DATA_DIR` — optional fallback only if Turso is not set (`/opt/render/project/src/data`)
   - Lemon Squeezy keys when ready (`LEMON_SQUEEZY_API_KEY`, `LEMON_SQUEEZY_STORE_ID`, `LEMON_SQUEEZY_VARIANT_MONTHLY`, `LEMON_SQUEEZY_WEBHOOK_SECRET`, …)
   - SMTP for password reset (see below)
5. Deploy → open the `.onrender.com` URL

With Turso set, signups survive Render redeploys. Create the DB at [app.turso.tech](https://app.turso.tech/).

## 2b) Password reset email (Gmail you already have)

On Render → **hearthlist** → **Environment**, add:

| Key | Value |
|-----|--------|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your full Gmail address |
| `SMTP_PASSWORD` | Gmail **App Password** (not your normal password) |
| `SMTP_FROM` | same Gmail address (or `Hearthlist <you@gmail.com>`) |
| `SMTP_USE_TLS` | `1` |
| `BASE_URL` | `https://hearthlist.onrender.com` |

Create an App Password: Google Account → **Security** → **2-Step Verification** (on) → **App passwords** → generate one for Mail → paste into `SMTP_PASSWORD`.

Then open `/forgot-password` on the live site and test with your own signup email.

## 3) Lemon Squeezy

1. Create product **Hearthlist** (subscription) in Lemon Squeezy — see `E:\winsome-anvil\LEMON-SETUP.md`
2. Add variant IDs / API key / store ID to Render env
3. Webhook URL: `https://YOUR-APP.onrender.com/billing/webhook`
4. Events: `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_expired`, `subscription_payment_success`, `subscription_payment_failed`
