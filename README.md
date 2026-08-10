# Hearthlist

One place for **groceries, meals, and chores** — a calm shared household hub.

## Local run (Windows)

```powershell
cd E:\hearthlist
py -3 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\start-hearthlist.bat
```

Open **http://127.0.0.1:5060**

## Features

- Landing page with lifestyle photography
- Email/password accounts
- Shared grocery list
- Weekly meal planner (breakfast / lunch / dinner)
- Chore board with assignee + due date
- Household invite codes / join links
- 7-day trial, then subscribe (Stripe when keys are set)

## Stripe (optional for local)

Copy `.env.example` to `.env` and add:

- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_PRICE_MONTHLY`
- `STRIPE_PRICE_YEARLY`
- `BASE_URL=http://127.0.0.1:5060`

Without Stripe keys, Account → **Activate test plan** unlocks paid limits for development.

## Deploy

See [DEPLOY.md](DEPLOY.md).
