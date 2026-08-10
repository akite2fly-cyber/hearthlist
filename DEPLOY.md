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
   - `DATA_DIR` — `/opt/render/project/src/data`
   - `BASE_URL` — your live URL, e.g. `https://hearthlist.onrender.com`
   - Stripe keys when ready (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_MONTHLY`, …)
5. Deploy → open the `.onrender.com` URL

## 3) Stripe live later

1. Create products/prices in Stripe
2. Add price IDs to Render env
3. Set webhook to `https://YOUR-APP.onrender.com/billing/webhook`
