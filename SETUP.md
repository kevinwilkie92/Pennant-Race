# Pennant Race — setup

Monorepo layout

| Path | What it is |
|---|---|
| `packages/domain` | League rules shared by API and app: max bid, keeper costs, scoring, position eligibility, roster slots (12 tests) |
| `api/` | Cloudflare Worker (Hono) + D1 database + Durable Object for the live draft room |
| `app/` | Expo / React Native app (iOS, Android and web) |
| `design/`, `screenshots/` | Design handoff — the visual and behavioural spec |

Requires Node 20+.

```bash
npm install            # once, at the repo root
npm test               # domain rule tests
npm run typecheck      # all three packages
```

## 1. Run the API locally

```bash
cd api
echo 'JOIN_CODE=pick-a-secret' > .dev.vars     # league join code, local only
npx wrangler d1 migrations apply pennant-race --local   # schema + 2026 draft seed
npm run dev                                    # http://localhost:8787
```

The seed (`api/migrations/0002_seed.sql`) is generated from `design/draft-data-2026.js`:
12 teams, 929 players, every 2026 roster slot, draft prices and keepers.
Regenerate it with `npm run seed:sql` if the data file changes.

## 2. Run the app

```bash
cd app
cp .env.example .env     # EXPO_PUBLIC_API_URL=http://localhost:8787
npm run web              # or: npm run start  (scan the QR code with Expo Go)
```

On the login screen choose **Join with your league code**, enter the `JOIN_CODE`, pick your team and set a password.
On a physical phone, set `EXPO_PUBLIC_API_URL` to your computer's LAN address.

## Running the draft

Open the app's ☰ menu. **Big Board (TV)** (`/draft` on the web build) is the commissioner's screen for the TV.
**Draft Room** (`/draft-room`) is the phone companion every manager uses.

1. Commissioner (team `AM`) signs in to the Big Board and chooses **PUSH TO 2027 SEASON** (shown once the previous season is final).
   This opens 2027 and carries rosters and eligible positions forward.
2. **KEEPERS** tab: pick a team and click players to keep them (max 5 per team). Buckets follow the rollover rules:
   last year's Year-2 keepers are *Not Eligible*, Year-1 keepers become *Year 2* (cost = ESPN average salary — the
   commissioner types each one in with **SET**), everyone else is *Year 1* (last price + $5, or $5 if undrafted).
   Owners can edit their own team's keepers; costs come off the budget and the player takes a roster slot immediately.
   Keepers lock as soon as the first auction sale is recorded.
3. **NEXT TEAM** draws an MLB team from the hat (**SHUFFLE HAT** redraws). Everyone else's screen follows instantly.
4. Click **DRAFT** on a player, choose the winning manager, enter the bid, **AWARD**. Bids are checked on the server
   (≥ $1, ≤ the manager's max bid, open roster spot). **UNDO** reverts the last sale.
5. Non-commissioners see the same board live, read-only. Tabs: Draft Board · Rosters · Undrafted · Draft Log.
6. Phone companion (read-only, live): on-the-clock team, latest pick, your wallet (budget / max bid / spots),
   player board with position filters and eligible positions, every manager's money, tap a manager for their roster,
   your roster, and the draft log.

Check the keeper and season rules end to end with `node api/scripts/keepers-e2e.mjs` (instructions at the top of the file).

## 3. Deploy to Cloudflare

```bash
cd api
npx wrangler login
npx wrangler d1 create pennant-race          # copy the database_id into wrangler.toml
npx wrangler r2 bucket create pennant-race-logos
npx wrangler secret put JOIN_CODE            # the code your league members will use
npm run db:migrate:remote
npm run deploy                               # prints https://pennant-race-api.<you>.workers.dev
```

Then host the web app on Cloudflare Pages:

```bash
cd app
EXPO_PUBLIC_API_URL=https://pennant-race-api.<you>.workers.dev npx expo export --platform web
npx wrangler pages deploy dist --project-name pennant-race
```

For the phone apps, build with EAS (`npx eas build`) pointing at the same API URL.

## What's built vs. next

Built: shared rules + tests, D1 schema, seeded 2026 data, email/password auth with join code,
roster / draft-state / commissioner sale + undo endpoints with server-side bid validation,
live draft broadcast (Durable Object WebSocket at `/draft/ws?token=…`), and the app's
login, My Team lineup, League team list/rosters, theme switcher (dark/light/broadcast/network),
the phone draft companion, the keepers picker + season push, and the TV draft board (hat draw, award card with bid validation, money rail, rosters, undrafted, log, undo, live sync).

Next, roughly in order: Matchup + daily points (needs an MLB stats feed), Players/free agents and
waivers/trades, standings and playoff bracket, chat, the draft room UIs (TV board + phone companion),
Draft-room edits to archived results,, team logo upload (R2), Google/Apple sign-in.
