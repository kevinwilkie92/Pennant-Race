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

## Matchups, standings and playoffs

The commissioner opens **League** and enters the Monday week 1 starts; that creates 26 Monday–Sunday weeks and a
23-week round-robin. Then:

- **Standings:** W-L, PCT, GB, streak, PF, PA, FAAB (tap a header to sort), playoff line after team 6, `x` clinched / `e` eliminated.
- **Matchups:** every game for a week; tap one to open it exactly like the Matchup tab.
- **Matchup tab:** your game for the current week, week switcher, Mon–Sun day toggle, rosters side by side
  (top number = that day's points, bottom = week total).
- **Bracket:** 6 teams, weeks 24–26 — seeds 1–2 get byes; QF 3v6 and 4v5; SF 1 v (4/5 winner), 2 v (3/6 winner);
  week 26 championship and 3rd-place game. Ties go to the higher seed. Seeds lock when week 23 ends.

Run `node api/scripts/league-e2e.mjs` to verify the math (it uses synthetic points and recomputes standings independently).
To preview a finished season in the app, build with `EXPO_PUBLIC_AS_OF=2027-10-01` (demo only; the date the app treats as "today").

## Lineups (My Team)

- **Move / swap:** tap a player, pick a slot he's eligible for (empty slots are shown); if someone's there, they swap
  (and must be eligible for the vacated slot). Hitters → INF/UTIL/OF rules, SP/RP only with that eligibility, bench takes anyone.
- **Day stepper:** past days show the lineup *as it was* and the actual points; today and future days are editable.
  A change applies from the day you make it (or a future day you pick) — it never rewrites history.
- **First-pitch lock:** once a player's MLB team has started its game that day he can't be moved, and nobody can swap
  into his slot. Locks need game start times in the `mlb_game` table, which the stats feed will fill; until then nothing locks.
- Bench points are shown but not counted in the day's total.
- Under the hood: `lineup_history` (one row per slot change with its effective date) lets the feed credit each day's points
  to the slot the player held that day. Not built: "Optimize" (needs projections), lineup views for other teams.

Run `npm run test:e2e` to run every end-to-end suite (keepers, league, lineup) against a fresh local database; no network needed.

## Stats feed — NOT connected yet

Points come from the `daily_points` table (`season, date, team_id, player_id, slot, points`); everything above reads it.
The MLB Stats API (`statsapi.mlb.com`) is the chosen source, but the cloud environment this was built in blocks that host,
so no ingestion code exists yet and **every score is 0 until it does**. To finish it:

1. Allow `statsapi.mlb.com` in the environment's network settings (or run the work on a machine that can reach it).
2. Map our players to MLB person ids (new `player.mlb_id` column; match by name + team, review the misses by hand).
3. A scheduled Worker (Cron Trigger) pulls each day's schedule and boxscores, turns them into stat lines, scores them with
   `scoreHitter` / `scorePitcher` (helpers `parseInnings`, `isQualityStart`, `singles` are in `@pennant/domain`), and writes `daily_points`.
4. Update `player_position` from games played/started so eligibility (5 starts / 10 games; SP after 3 starts, RP after 5 relief apps) follows the real season.

The feed also needs to fill `mlb_game` (first-pitch times, for the lineup lock) and should write each `daily_points` row's
`slot` from `lineup_history` (the slot he held that day) — the `/teams/:id/lineup?date=` endpoint already shows how to resolve it.

## What's built vs. next

Built: shared rules + tests, D1 schema, seeded 2026 data, email/password auth with join code, roster / draft-state /
commissioner sale + undo endpoints with server-side bid validation, live draft broadcast (Durable Object WebSocket),
the TV draft board, the phone draft companion, the keepers picker + season push, the schedule / standings / matchup /
bracket engine and screens, lineup editing with daily history and first-pitch locks, and the app's login, My Team, League, and theme switcher
(dark/light/broadcast/network).

Next, roughly in order: connect the stats feed (above), Players / free agents and
waivers / trades, chat, editing archived draft results, team logo upload (R2), Google/Apple sign-in, and a
"currently nominated player" strip for the phone companion.
