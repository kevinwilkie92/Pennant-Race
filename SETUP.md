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

Run `npm run test:e2e` to run every end-to-end suite (keepers, league, lineup, waivers, trades, extras, chat, logos, dm) against a fresh local database; no network needed.

## Players, waivers and FAAB

**Players tab:** *Available* (free agents), *Watchlist* (per user, ☆/★), search that ignores accents, position chips,
sortable by player / position / team. **+ ADD** opens a claim: a FAAB bid ($0 allowed) and, if you want, a player to drop
(required when your 26-man roster is full). *Trending* and *Leaders* rank by recent production, so they show a note until the stats feed is connected.
**My Team → Transactions:** pending claims (reorder priority ▲▼, change the bid, change who you drop, cancel), results of past runs
(including why a claim lost), and your team's activity. **League → Activity** is the league-wide log. Dropping a player outright is in the lineup sheet.

**Waiver rules** (the README gave only the $300 budget, priorities and editable bids — these are my defaults, easy to change in
`packages/domain/src/waivers.ts`):
- Claims are processed together, nightly at 08:00 UTC (Cloudflare cron, see `api/wrangler.toml`) or on demand by the commissioner (**RUN WAIVERS NOW**).
- Highest bid wins a contested player. Equal bids go to the team earlier in the **rolling waiver order**, which starts alphabetical;
  a team that wins a claim moves to the back.
- One team's claims are tried in its own priority order; a failed claim falls through to its next one.
- A claim can fail for: player already taken, not enough FAAB, roster full without a drop, or the drop is no longer on the roster.
- A player dropped in a run can't be claimed in that same run, and one added in a run can't be dropped in it.
- The new player takes the dropped player's slot if he fits; otherwise the smallest set of players shift to make a legal lineup.
  Past days keep showing the lineup as it was (new players don't appear before they were added).
- FAAB resets to $300 and pending claims are cancelled when you push to a new season.

## Trades

**Propose:** My Team → **Trade**, or tap a player on another team's roster (League → a team), or **TRADE** next to an owned player in the
Players tab's watchlist — the partner and player come pre-selected. Tick what you give and what you want (up to 5 per side), send.
**Respond:** My Team → **Transactions → Trade offers**: the receiving manager **Accept**s or **Reject**s; the sender can **Cancel**.
Past trades show under *Past trades* and in **League → Activity**.

**Rules** (the README only lists Accept / Reject / Cancel — these are my defaults):
- An accepted trade takes effect immediately; there is no commissioner approval or review period. The commissioner can **cancel** any pending offer (a veto).
- Offers are re-checked when accepted. They can't go through if a player is no longer where the offer says, either roster would exceed 26,
  or a player's MLB game has already started today (same lock as lineups and drops). The pending list shows the reason.
- Accepting cancels any other pending offer that includes one of the traded players.
- Incoming players take a traded-away player's slot when he fits, otherwise the smallest set of players shift to make a legal lineup.
  Past days keep showing each lineup as it was.
- A pending waiver claim that planned to drop a traded-away player loses that drop.
- No trade deadline, counter-offers, or multi-team trades.

## Waiver period, injured list, player card

**Waiver period:** a player dropped (outright or by a winning claim) goes on waivers for **2 days** — the commissioner changes this under
My Team → Transactions (0 = claimable at the next run). Claims for him are allowed but **wait** (stay pending) until the period clears, then
compete normally. Trades don't trigger it. The Players tab and the add sheet show "On waivers until …".

**Injured list:** 4 IL slots (IL1–IL4) sit outside the 26-player roster. A player can go there only if he's ruled **IL or OUT** (day-to-day can't), and only
while injured does he stop counting toward the 26 — a healed player left on IL counts again. Dropping an IL player doesn't free an active spot,
and the claim and trade roster-limit checks use the active count. IL players show their points but aren't counted in the day's total.
Injury status is **entered by the commissioner** (status chips in the lineup sheet) until the stats feed supplies it.

**Player card:** tap a player in the Players tab (or *Player card* in the lineup sheet): owner or waiver status, injury, a points-by-day chart (negative days drawn
downward in red) built from `daily_points`, and the full history — draft/keeper price, waiver adds, drops and trades. **Season, game-log and career stats
need the stats feed**, so the card says so instead of showing numbers.

Not built yet: stats-based views (Trending, Leaders, game log, career), injury notes and 15/60-day IL types, a commissioner screen for league settings beyond the waiver period.

## League chat and direct messages

Tap 💬 in the header. Everything arrives live over the same WebSocket room the draft uses. The badge counts unread league messages and
direct messages, and turns gold with an **@** when someone mentioned your team.

- **League tab:** up to 500 characters per message, shown with the team's logo/colour and *current* name; 5 messages per 10 seconds per team; "Load earlier messages" pages back.
- **Direct tab:** a conversation list with unread counts, and *New message* to start one with any team. **Only the two teams can see a DM** — it is delivered only to their connections,
  and reading, reacting, editing or deleting it is refused for anyone else (the commissioner included; they can't moderate DMs).
- **Replies:** ＋ ⋯ → ↩ Reply. The reply quotes the original (or says it was deleted); a reply must stay in the same conversation.
- **@mentions:** type `@` and pick a team (or type `@RC`). Mentions show as the team's current name in gold; mentioned teams get the gold badge. Not used in DMs.
- **Images:** 📎 picks a photo, shrinks it (longest side 1280px), uploads it, and sends it with or without text. PNG/JPEG/WebP, 2 MB, 10 uploads a minute per team.
  The server checks the real bytes; SVG and GIF are refused. Image links are public but unguessable and only ever sent to people in the conversation.
  Deleting a message deletes its image. (An image that was uploaded but never sent stays in storage — a periodic cleanup is not built.)
- **Edit after send:** ＋ ⋯ → ✎ Edit on your own message (no time limit); it shows "(edited)", mentions are re-read, and everyone sees the change live.
- **Typing indicators:** "Team is typing…" in the league room, or only to the other person in a DM; expires after 4 seconds; rate-limited on the server.
- **Reactions, pinned announcement, moderation:** as before — the commissioner can pin/delete league-room messages; authors delete their own.

Not built: threads beyond a single quoted reply, group DMs, push notifications (the badge only updates while the app is open), read receipts, search.

## Team settings: logo and name

Tap the logo (⚙) on your My Team card → **Team settings**.
- **Logo:** *Upload logo* picks a photo and opens a **crop screen** — drag to position, zoom with − / + or the slider, and a circle shows what will be used. It is then shrunk to 256px and uploaded
  (PNG, JPEG or WebP). *Remove* goes back to your team colour. It shows on your team card, the standings, matchups, chat, the phone draft view and the **TV draft board**
  (Money rail, sold rows, rosters, keepers, draft log).
- **Live updates:** a rename or new logo reaches everyone's open screens at once (the team list is a shared live source).
- **Name:** 2–40 characters; another team's name (any capitalisation) is refused. The commissioner can edit any team.
- **How it's stored:** in the R2 bucket from the deploy steps (`pennant-race-logos`). Files get random names (so the URL changes with every upload and can be cached for a year);
  the old file is deleted on replace/remove. The server checks the file's real bytes — not its label — and rejects anything over 2 MB, SVG (can carry scripts), GIF and non-images.
  Logos are served without sign-in (images can't send credentials) with `nosniff` and a sandboxing CSP.

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
bracket engine and screens, lineup editing with daily history and first-pitch locks, the Players tab with FAAB waivers, trades, the waiver period, the injured list, player cards, league chat with direct messages, replies, @mentions, images, edits and typing indicators, team logos (with a crop screen) and names, and the app's login, My Team, League, and theme switcher
(dark/light/broadcast/network).

Next, roughly in order: connect the stats feed (above), editing archived draft results, Google/Apple sign-in, and a
"currently nominated player" strip for the phone companion.
