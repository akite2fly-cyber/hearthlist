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
   - Stripe keys when ready (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_MONTHLY`, …)
5. Deploy → open the `.onrender.com` URL

With Turso set, signups survive Render redeploys. Create the DB at [app.turso.tech](https://app.turso.tech/).

## 3) Stripe live later

1. Create products/prices in Stripe
2. Add price IDs to Render env
3. Set webhook to `https://YOUR-APP.onrender.com/billing/webhook`
