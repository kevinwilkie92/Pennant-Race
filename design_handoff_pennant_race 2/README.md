# Handoff: Pennant Race — Fantasy Baseball App (Carrollton All Stars)

## Overview
Pennant Race is a private fantasy baseball app for a 12-team, head-to-head points, keeper, auction-draft home league ("Carrollton All Stars"). It ships as:
1. **Mobile app** (iOS/Android-sized, primary) — `design/Pennant Race.dc.html`
2. **Web/desktop app** (same features, wide layout) — `design/Pennant Race Web.dc.html`
3. **Draft Room — TV big board** (commissioner-run, shown on a TV on draft night) — `design/Pennant Race Draft v2.dc.html` (new "broadcast" layout; `Pennant Race Draft.dc.html` is the previous version, same logic)
4. **Draft Room — mobile companion** (managers follow along on their phones) — `design/Pennant Race Draft Mobile.dc.html`

## About the Design Files
The files in this bundle are **design references created in HTML** — interactive prototypes showing the intended look and behavior, **not production code to copy directly**. Each `.dc.html` is a self-running prototype (it loads `support.js`, a small React-based runtime; open it in a browser). All data is mocked in-file (plus `draft-data-2026.js`) and persisted to `localStorage`.

The task is to **recreate these designs in a real app**. No codebase exists yet. Recommended stack:
- **Expo / React Native + React Native Web** (one codebase for iOS, Android and web), or **Next.js** (web) + Expo (mobile) sharing a TypeScript domain package.
- **Backend:** Supabase/Postgres (auth, realtime for draft + chat, row-level security per league) or Firebase.
- **MLB stats feed:** a licensed stats provider (e.g. Sportradar, MySportsFeeds, or the public MLB Stats API for non-commercial use) for players, games, box scores, and position appearances.
- **Realtime:** the draft room and chat need websocket/realtime sync (TV board, commissioner and phones all show the same state).

Treat the logic class in each file (`class Component extends DCLogic { … }`) as the behavioral spec. It holds the scoring math, roster-slot rules, keeper cost rules, max-bid formula, etc.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, copy and interactions. Recreate the UI pixel-accurately. Mock numbers (points, stats, projections) are placeholders to be replaced by the live feed.

---

## League rules (domain logic — implement server-side)
- **12 teams**, head-to-head **points**. Owners: Acuña Matata (Kevin, *the user's team*, id `AM`), Rally Cats (Katie), Might as well JUMP! (Michael), kylespayde518's Speedster (Kyle), Witt and Wisdom (Amato), Hogan's Heroes (Ed), Ozzie's Pet Fish (Sam), Coming En Fuego (Curtis), My Cousin Vinnie (Joe), Dream City Beer Snobs (Joel), Ace Dan (Dan), Drake is the Best Baldwin Bro (Richie).
- **Lineup slots (26):** Hitters `C, 1B, 2B, 3B, SS, INF, OF, OF, OF, OF, UTIL, UTIL`. Pitchers `SP, SP, SP, SP, RP, RP, RP, RP, P…` per the `ROSTER` / `HIT_SLOTS` / `PIT_SLOTS` constants in the files. The rest are bench (BN). Display order is always: Hitters (in slot order, INF after SS), then Pitchers (SP×4, then RP×4), then **Bench at the bottom**.
- **Scoring (editable in League Settings):** Hitting `1B 1, 2B 2, 3B 3, HR 4, BB 1, IBB 1, R 1, RBI 1, SB 2, SO −1`. Pitching `IP 3, K 1, W 2, QS 5, SV 5, HLD 2, CG 3, SHO 3, ER −2, H −1, BB −1`.
- **Max starts per week** (pitchers), default 12, editable. Track starts used/remaining on My Team and Matchup. Tapping the counter lists each start that week (player, date, points).
- **Shohei Ohtani is two players**: "Shohei Ohtani (Batter)" and "Shohei Ohtani (Pitcher)", rostered, drafted and kept independently.
- **Position eligibility (Yahoo rules):** hitters gain a position after **5 starts or 10 total appearances** there. Pitchers gain **SP after 3 starts** and **RP after 5 relief appearances**. Eligibility is based on the **previous + current season**, and once gained it is kept for the rest of the season. Always display under the player name: `MLB TEAM · POS1,POS2,…` (team first, then all eligible positions).
- **FAAB budget** $300/season. Waiver claims are listed with priority and are editable in My Team → Transactions.
- **Auction draft:** budget **$300**, **$1 minimum bid**, 26 roster spots. **Max bid = remaining budget − (empty spots − 1)**, i.e. hold back $1 per remaining open spot.
- **Hat draw nomination:** MLB team names are drawn from a hat. Only players from the drawn MLB team are nominated until nobody wants to nominate more, then the next team is drawn. The next team is a **mystery** (no "up next" preview). The commissioner can manually pick the drawn team or shuffle the hat.
- **Keepers:** up to **5 per team**. A keeper's cost comes out of the draft budget and the player fills a roster slot before the draft. **Year 1 cost** = last year's draft price + $5 (flat $5 if undrafted). **Year 2 cost** = ESPN average salary (rounded). A player can be kept **at most 2 consecutive years**, then he returns to the draft and his clock resets. A player not kept the prior year is always at Year 1 cost.
- **Season rollover ("Push to 2027"):** archive the 2026 draft board (read-only but commissioner-editable for corrections). Keeper buckets for the new year: players marked **Y2** become **Not Eligible**, **Y1** players move to the **Year 2** section, and every other player rostered at season end goes to the **Year 1** section.
- **Playoffs:** 6 teams, starting week 24, top 2 seeds get byes. Bracket: Quarterfinals (Wk 24) → Semifinals (Wk 25) → Championship + 3rd Place (Wk 26). Standings show a playoff clinch/cut line.

## Screens / Views — Mobile app (`Pennant Race.dc.html`)
Phone frame 386×836. Bottom nav (4 tabs, custom PNG icons in `design/icons/`): **My Team · Matchup · Players · League**. Icons and labels are always solid white on a dark nav bar in every theme. The active tab gets the red accent. The header has a hamburger (left), logo, and chat (right).

- **Login:** full-bleed stadium photo (`stadium.png`) behind, with the logo (`logo.png`, white glow drop-shadow) and the card positioned low so the stadium shows above it. Email/password, show-password toggle, "Continue with Google/Apple" (no Facebook). Always uses dark styling regardless of theme.
- **My Team:** always the lineup view.
  - **Team header card:** team logo with a gear icon at its base that opens Team Settings (team name, logo upload). Record, rank, FAAB, starts used/max.
  - **Day stepper:** past days show **actual points**. Each row shows actual on top and projected below. The selected day's team total is shown.
  - **Lineup rows:** slot badge, player name, `TEAM · POS,POS` subline, points. Tapping a row opens swap/move. "Optimize" button.
  - **Sub-nav:** Lineup · Schedule · Trade · Transactions (pending waiver claims, editable bids/priority/drop; pending trades sent/received/accepted with Accept/Reject/Cancel) · News.
- **Matchup:** defaults to the user's matchup for the current week (user is always the home team).
  - Header: score head-to-head with both team names and logos, plus a day toggle (Mon–Sun) showing that day's point totals.
  - Rosters side-by-side (Yahoo-style): **HITTERS / PITCHERS / BENCH** sections in slot order. Each player shows **top number = points that selected day** and **bottom = week total**.
  - Week switcher.
- **Players:** Available / Watchlist / Trending / Leaders sub-views. Search, position filter chips, sortable columns (name, pos, % owned, last 7, projection). Add/drop and watch star. Each row has the team/positions subline.
- **League:**
  - **Standings:** sortable columns: W-L, PCT, GB, streak, **PF, PA, FAAB remaining**. Team logos. Playoff clinch line. Click a team to open their roster.
  - **Matchups:** all league matchups for the week. Opening one renders exactly like the Matchup tab.
  - **Activity:** league-wide waiver and trade log.
  - **Bracket:** playoff bracket.
  - **Prizes**.
- **Player card (bottom sheet, drag to dismiss):** team-color gradient over a solid navy base (opaque). Sub-tabs: Season · Game Log · Career · **History** (all transactions: Draft, Waiver, Trade with date/price). Bar chart of recent points with **negative points drawn downward in red**. In light theme, text that is white in dark theme becomes red/dark for readability.
- **Hamburger menu:** Draft Room (mobile companion), Big Board (TV), Season History, League Settings (commissioner: scoring, max starts, rules, schedule, commissioners), Theme selector, Sign out.
- **Chat overlay:** pinned commissioner announcement, messages with team color avatars, tap-to-react emoji chips with counts.
- **Season History:** past champions, standings, draft board archive.

## Screens / Views — Web app (`Pennant Race Web.dc.html`)
Design canvas 1320×840. The same features as mobile, laid out wide:
- **Left sidebar (248px):** logo, nav (My Team, Matchup, Players, League), Season History, Draft Room link, theme selector, and the user's team card at the bottom.
- **Topbar:** week stepper, search, chat.
- Content areas use wide tables and two-column layouts (e.g. My Team lineup + News rail, Matchup with side-by-side rosters, full standings table). Modals replace the mobile bottom sheets.
- The tab structure must match mobile exactly (no Home tab).

## Screens / Views — Draft Room TV board (`Pennant Race Draft v2.dc.html`)
Full-screen, designed for a TV (≥1450px wide). Charcoal broadcast look.
- **Top nav (64px, #0d0f13):** back arrow, logo plus "CARROLLTON ALL STARS" (Saira Condensed 800, 22px, letter-spacing 1.5px). Tabs: **DRAFT BOARD · ROSTERS · UNDRAFTED · KEEPERS · DRAFT LOG** (14px, 800, active tab has a 3px red underline). Right side: year pill (2026 FINAL / 2027 LIVE, with a dropdown that includes "PUSH TO 2027 SEASON"), UNDO, settings gear, and "N/N DRAFTED".
- **Left rail (118px):** gradient in the drawn MLB team's secondary color. Team logo, team nickname set vertically (900, 56px). Stats: SOLD (gold #f2b632), LEFT, TEAM n/N.
- **Hero (≥280px):** same team gradient. Kicker "ON THE CLOCK · DRAWN FROM THE HAT" (gold, letter-spacing 5px). Team name at 72px/900. Subcopy is "Click Draft on any player below to put them up for auction." when live, or "Click any player to edit the final result." in the archive. Right control column (250px): team select, ‹ prev, red "NEXT TEAM ›", "SHUFFLE HAT", player filter.
- **Position columns (4 equal columns):** C/IF (#2bb0c4), OF+DH (#5fbf6f), SP (#8a7dff), RP (#e08a3b). Each column has a colored code tag and "N LEFT". Player rows (#161a22): square avatar with a position-color border, **name in Saira 800 25px**, sub-line, and a red **DRAFT** button (live only). Sold rows are dimmed (#101319) and show the price in green (#2fbf63) plus the winning manager's abbreviation in their color.
- **Click a player → award card:** choose the winning manager (dropdown shows each manager's max bid) and enter the winning bid. This is validated: ≥ $1, ≤ that manager's max bid, and the manager must have an open spot.
- **Right rail "The Money" (310px):** every manager with a color edge bar, remaining $ (green), max bid (gold), and a budget bar. Clicking a manager opens Rosters.
- **Rosters tab:** 6×2 grid of manager cards. Each shows slots in order, filled/empty, cost, Y1/Y2 keeper badges, Max / $ left / filled count.
- **Undrafted tab:** all undrafted players grouped by position, with filter and "N LEFT".
- **Keepers tab:** per-team keeper picker (max 5) with costs auto-calculated by the rules. Three columns: **Year 1**, **Year 2**, **Not Eligible**.
- **Draft Log:** chronological sales. **Undo** reverts the last sale.
- Team colors: the 2026 Pirates swap primary/secondary, and their banner glow is black.

## Draft Room mobile companion (`Pennant Race Draft Mobile.dc.html`)
Read-mostly phone view of the same live draft: on-the-clock team, players sorted by position with all eligible positions and player cards, managers' money, and tap any team to see its roster and who they've drafted.

## Interactions & Behavior
- **Theme:** four options persisted per device: **Dark** (default navy), **Light**, **Broadcast** (charcoal #0b0d11, sports-TV style, score ticker, non-italic type, 5px radii), **Network** (light gray #eceef1 page, white cards, near-black sidebar/ticker, all-caps condensed headings, ~2px corners). Login and bottom nav always stay dark.
- **Transitions:** tab content fades in (`opacity 0→1, translateY 8–10px → 0, .35s ease`). Toasts slide up from the bottom. The player sheet slides in with `transform .28s ease` and supports drag-to-dismiss.
- **Sorting:** clicking a column header toggles desc/asc and shows an arrow.
- **Validation:** bids are an integer ≥ $1 and ≤ the manager's max bid. Keepers are capped at 5 per team, and Y2 players are not eligible.
- **Persistence (prototype only):** `localStorage` keys `prTheme`, `prThemeWeb`, `prTeamName`, `prTeamLogo`, `prMaxStarts`, `prDraftDate`, draft state. Move all of this to the backend except theme.
- **Realtime:** draft sales, undo, hat draws and chat broadcast to all clients.
- **Roles:** the commissioner (`commissioners: ['AM']`) can edit league settings, run the draft, edit archived results, and push the season.

## State Management (suggested data model)
`League` (name, settings, scoring, rules, schedule, commissioners) · `Season` (year, status live/archived) · `Team` (owner, name, logo, color, FAAB) · `Player` (MLB id, name, MLB team, eligible positions per season, two Ohtani entities) · `RosterSlot` (team, player, slot, date) · `Matchup` (week, home, away, daily points) · `DraftSale` (season, player, team, price, order) · `Keeper` (season, team, player, year 1|2, cost) · `Transaction` (type draft/waiver/trade/add/drop, players, FAAB, status, timestamps) · `WaiverClaim` · `TradeOffer` (status pending/accepted/rejected/cancelled) · `ChatMessage` (+ reactions, pinned).
UI state per screen is visible in each file's `state = { … }` block (tab, sub-tab, selected day, week, sort keys, open overlays).

## Design Tokens
**Fonts (Google Fonts):** `Saira Condensed` (display, 700–900, often italic in Dark/Light themes) · `Barlow` (UI/body 400–700) · `Barlow Semi Condensed` (numbers, 600–700).
**Dark (default):** bg #0a1a30 · panel #0d2342 · card rgba(255,255,255,.045) · card2 rgba(255,255,255,.07) · line rgba(255,255,255,.08) · text #ffffff · dim #90a4bf · dim2 #5f7d9c
**Light:** bg #eef2f7 · panel #ffffff · card rgba(14,32,56,.05) · line rgba(14,32,56,.13) · text #12233d · dim #5a6b80 · dim2 #8a99ab
**Broadcast:** bg #0b0d11 · panel #12151b · card #161a22 · card2 #1c212b · text #fff · dim #a3aab5 · dim2 #6f7782
**Network:** bg #eceef1 · panel/card #ffffff · card2 #f3f4f6 · sidebar #121417 · line rgba(17,20,24,.12) · text #111418 · dim #565d69 · dim2 #868d97
**Accents:** red #e22634 · red-soft #ec3b48 · green #2e9e5b / #33b06a / #2fbf63 (money) · gold #d19a1f / #f2b632 · blue #3b74d6 · loss red #ec3b48
**Position colors:** C/IF #2bb0c4 · OF #5fbf6f · SP #8a7dff · RP #e08a3b
**Radii:** 7–9px (chips), 10–13px (buttons/inputs), 14–16px (cards), 56/46px (phone frame). Broadcast uses 5px, Network ~2px, Draft v2 square.
**Shadows:** cards `0 18px 44px -22px rgba(0,0,0,.8)`. Red CTA `0 10px 22px -10px rgba(226,38,52,.7)`. Menus `0 20px 50px -18px rgba(0,0,0,.8)`.
**Spacing:** 4/6/8/10/12/14/16/18/22/26/30px steps. Screen padding is 16–20px on mobile and 22–30px on web.
**Team colors:** the 12 league teams' colors are in `draft-data-2026.js` (`managers[].color`). MLB primary/secondary colors are in the draft files' `MLB` constant.

## Assets
- `logo.png`: Pennant Race P/R star mark (transparent). Always rendered with a white glow: `drop-shadow(0 0 1–2px rgba(255,255,255,.9))` ×2.
- `stadium.png`: login background.
- `icons/roster.png, matchups.png, players.png, standings.png`: bottom-nav and sidebar icons (user-provided).
- MLB team logos are loaded per team. **Licensing note:** MLB logos and marks are trademarks. Use a licensed source or the stats provider's asset feed in production.
- Player headshots are placeholder silhouettes. Get real headshots from the stats provider.

## Data
- `draft-data-2026.js` (`window.PR2026`) contains the real **2026 draft results** (player, MLB team, winning manager, price), the 2026 keepers with Y1/Y2 designations and costs, and the can't-keep list. Use it as seed data.
- Rosters in the main apps are seeded from these 2026 results.

## Files
- `design/Pennant Race.dc.html`: mobile app (all screens)
- `design/Pennant Race Web.dc.html`: web/desktop app
- `design/Pennant Race Draft v2.dc.html`: TV draft board (current design)
- `design/Pennant Race Draft.dc.html`: previous TV draft board (same logic)
- `design/Pennant Race Draft Mobile.dc.html`: mobile draft companion
- `design/Pennant Race Web (Standalone).html`, `design/Pennant Race Mobile (Standalone).html`: offline single-file snapshots (may predate the latest changes; prefer the `.dc.html` files)
- `design/draft-data-2026.js`, `design/support.js` (prototype runtime only, not needed in production), `design/logo.png`, `design/stadium.png`, `design/icons/`

## Screenshots (`screenshots/`, Broadcast theme unless noted)
- `01-mobile.png` (login) · `m-02-my-team.png` · `m-03-matchup.png` · `m-04-players.png` · `m-05-league.png`: mobile
- `w-01-my-team.png` · `w-02-matchup.png` · `w-03-players.png` · `w-04-standings.png` · `w-05-bracket.png`: web
- `d-01-board.png` · `d-02-rosters.png` · `d-03-keepers.png`: TV draft room (v2), 2026 archive
Screenshots are a quick reference. The `.dc.html` prototypes are the source of truth for every state, theme and overlay.

To view a prototype, serve the `design/` folder locally (e.g. `npx serve design`) and open any `.dc.html`.
