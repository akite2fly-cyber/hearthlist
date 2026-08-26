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
- 7-day trial, then subscribe (Lemon Squeezy when keys are set)

## Lemon Squeezy (optional for local)

Copy `.env.example` to `.env` and add (see `E:\winsome-anvil\LEMON-SETUP.md`):

- `LEMON_SQUEEZY_API_KEY`
- `LEMON_SQUEEZY_STORE_ID`
- `LEMON_SQUEEZY_VARIANT_MONTHLY` (and yearly if used)
- `LEMON_SQUEEZY_WEBHOOK_SECRET`
- Or a share link: `LEMON_SQUEEZY_CHECKOUT_MONTHLY`
- `BASE_URL=http://127.0.0.1:5060`

Without Lemon keys, Account → **Activate test plan** unlocks paid limits for development.

Brand storefront (separate site): `E:\winsome-anvil` → winsomeanvil.com

## Deploy

See [DEPLOY.md](DEPLOY.md).
