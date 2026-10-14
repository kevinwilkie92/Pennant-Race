// Generates api/migrations/0002_seed.sql from design/draft-data-2026.js (the real 2026 draft).
// Run: npm run seed:sql
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.window = {};
// eslint-disable-next-line no-eval
(0, eval)(readFileSync(path.join(root, 'design/draft-data-2026.js'), 'utf8'));
const d = window.PR2026;

const q = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const out = [];
out.push(`INSERT INTO league (id, name) VALUES (1, 'Carrollton All Stars');`);
out.push(`INSERT INTO season (year, status) VALUES (${d.season}, 'archived');`);

for (const m of d.managers) {
  out.push(`INSERT INTO team (id, owner_name, name, color, is_commissioner) VALUES (${q(m.id)}, ${q(m.first)}, ${q(m.team)}, ${q(m.color)}, ${m.id === 'AM' ? 1 : 0});`);
}
for (const [abbr, t] of Object.entries(d.teams)) {
  out.push(`INSERT INTO mlb_team (abbr, name, logo, color, color2) VALUES (${q(abbr)}, ${q(t.name)}, ${q(t.logo)}, ${q(t.color)}, ${q(t.color2)});`);
}

// Seed data marks some names with a trailing '*' (e.g. 'Aaron Civale*'); keep names verbatim so they stay unique.
const seen = new Set();
let seq = 0;
const players = d.players.filter((p) => {
  if (!seen.has(p.n)) { seen.add(p.n); return true; }
  if (p.o) throw new Error(`duplicate owned player ${p.n}`);
  console.warn(`skipping duplicate undrafted row: ${p.n}`);
  return false;
});
for (const p of players) {
  out.push(`INSERT INTO player (name, mlb_team, pos, pos2) VALUES (${q(p.n)}, ${q(p.mlb)}, ${q(p.p)}, ${q(p.p2)});`);
}
const id = (n) => `(SELECT id FROM player WHERE name = ${q(n)})`;
for (const p of players) {
  for (const pos of [p.p, p.p2]) if (pos) out.push(`INSERT OR IGNORE INTO player_position (player_id, season, position) VALUES (${id(p.n)}, ${d.season}, ${q(pos)});`);
  if (!p.o) continue;
  if (p.s) out.push(`INSERT INTO roster_slot (season, team_id, player_id, slot) VALUES (${d.season}, ${q(p.o)}, ${id(p.n)}, ${q(p.s)});`);
  seq += 1;
  out.push(`INSERT INTO draft_sale (season, player_id, team_id, price, seq, is_keeper) VALUES (${d.season}, ${id(p.n)}, ${q(p.o)}, ${Math.max(1, p.pr ?? 1)}, ${seq}, ${p.k ? 1 : 0});`);
  if (p.k) out.push(`INSERT INTO keeper (season, team_id, player_id, year, cost) VALUES (${d.season}, ${q(p.o)}, ${id(p.n)}, ${p.k}, ${Math.max(1, p.pr ?? 1)});`);
}
const file = path.join(root, 'api/migrations/0002_seed.sql');
writeFileSync(file, out.join('\n') + '\n');
console.log(`wrote ${out.length} statements -> ${path.relative(root, file)}`);
