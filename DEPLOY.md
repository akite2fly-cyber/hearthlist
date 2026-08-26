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
5. Deploy → open the `.onrender.com` URL

With Turso set, signups survive Render redeploys. Create the DB at [app.turso.tech](https://app.turso.tech/).

## 3) Lemon Squeezy

1. Create product **Hearthlist** (subscription) in Lemon Squeezy — see `E:\winsome-anvil\LEMON-SETUP.md`
2. Add variant IDs / API key / store ID to Render env
3. Webhook URL: `https://YOUR-APP.onrender.com/billing/webhook`
4. Events: `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_expired`, `subscription_payment_success`, `subscription_payment_failed`
