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
login, My Team lineup, League team list/rosters, theme switcher (dark/light/broadcast/network).

Next, roughly in order: Matchup + daily points (needs an MLB stats feed), Players/free agents and
waivers/trades, standings and playoff bracket, chat, the draft room UIs (TV board + phone companion),
keeper picker and "Push to 2027", team logo upload (R2), Google/Apple sign-in.
