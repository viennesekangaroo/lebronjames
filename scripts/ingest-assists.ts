/**
 * Ingests LeBron's two-way assist relationships from the NBA Stats PBP CSVs
 * (shufinskiy/nba_data) and writes per-teammate aggregates to two tables:
 *
 *   lebron_assists_to    — assists LeBron threw to each teammate
 *   lebron_assisted_by   — assists each teammate threw to LeBron
 *
 * Schema (both tables):
 *   teammate_player_id  INTEGER  — players.id of the other player
 *   assists             INTEGER  — count of made FGs in this direction
 *   points_off          INTEGER  — points scored on those FGs (2 or 3)
 *
 *   Run: npm run ingest:assists
 *
 * Detection: EVENTMSGTYPE=1 (made FG). PLAYER1 = scorer, PLAYER2 = assister.
 *   - "to":  PLAYER2 = LeBron (LeBron assisted PLAYER1)
 *   - "by":  PLAYER1 = LeBron AND PLAYER2 != 0/empty (someone assisted LeBron)
 *
 * "3PT" in the play description distinguishes 3-pointers from 2s.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { openDb } from "../src/lib/db";

const RAW_DIR = path.join(process.cwd(), "data", "raw", "pbp");
const DB_PATH = path.join(process.cwd(), "data", "nba.db");
const LEBRON_PERSON_ID = "2544";

const SEASONS = Array.from({ length: 22 }, (_, i) => 2003 + i); // 2003..2024

const URL_FOR = (season: number) =>
  `https://github.com/shufinskiy/nba_data/raw/main/datasets/nbastats_${season}.tar.xz`;

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

async function downloadIfMissing(season: number): Promise<string> {
  ensureDir(RAW_DIR);
  const archive = path.join(RAW_DIR, `nbastats_${season}.tar.xz`);
  const csv = path.join(RAW_DIR, `nbastats_${season}.csv`);
  if (fs.existsSync(csv)) return csv;
  if (!fs.existsSync(archive)) {
    process.stdout.write(`  ↓ downloading ${season}... `);
    const res = spawnSync("curl", ["-sSL", "-o", archive, URL_FOR(season)], { stdio: "inherit" });
    if (res.status !== 0) throw new Error(`curl failed for ${season}`);
    process.stdout.write("done\n");
  }
  process.stdout.write(`  ↳ extracting ${season}... `);
  const res = spawnSync("tar", ["-xJf", archive, "-C", RAW_DIR], { stdio: "inherit" });
  if (res.status !== 0) throw new Error(`tar failed for ${season}`);
  process.stdout.write("done\n");
  return csv;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"') inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// direction is from LeBron's POV:
//   "to"  → LeBron assisted teammate (LeBron is PLAYER2, teammate is PLAYER1=scorer)
//   "by"  → teammate assisted LeBron (LeBron is PLAYER1=scorer, teammate is PLAYER2)
type Direction = "to" | "by";
type Row = { teammateId: number; points: number; direction: Direction };

async function processSeason(csvPath: string): Promise<Row[]> {
  const stream = fs.createReadStream(csvPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const out: Row[] = [];

  let header: string[] | null = null;
  let idx: Record<string, number> = {};

  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      idx = Object.fromEntries(header.map((h, i) => [h, i]));
      continue;
    }
    if (!line.includes(LEBRON_PERSON_ID)) continue;
    const cols = parseCsvLine(line);

    if (cols[idx.EVENTMSGTYPE] !== "1") continue; // made FG only

    const p1 = cols[idx.PLAYER1_ID];
    const p2 = cols[idx.PLAYER2_ID];

    let direction: Direction | null = null;
    let teammateIdStr = "";
    if (p2 === LEBRON_PERSON_ID && p1 && p1 !== LEBRON_PERSON_ID && p1 !== "0") {
      direction = "to";
      teammateIdStr = p1;
    } else if (p1 === LEBRON_PERSON_ID && p2 && p2 !== LEBRON_PERSON_ID && p2 !== "0") {
      direction = "by";
      teammateIdStr = p2;
    } else {
      continue;
    }

    const home = cols[idx.HOMEDESCRIPTION] ?? "";
    const visitor = cols[idx.VISITORDESCRIPTION] ?? "";
    const desc = home || visitor;
    if (!desc) continue;

    const teammateId = parseInt(teammateIdStr, 10);
    if (!Number.isFinite(teammateId) || teammateId <= 0) continue;

    // Made FGs are 2 or 3 points; "3PT" appears in the description for threes.
    const points = /\b3PT\b/.test(desc) ? 3 : 2;
    out.push({ teammateId, points, direction });
  }
  return out;
}

async function main() {
  // Full re-ingest only — both tables are dropped and rebuilt each run.
  const seasons = SEASONS;

  const db = openDb(DB_PATH);
  // New schema uses `teammate_player_id` for both directions. The old
  // `scorer_player_id` column survives in pre-existing DBs; the API code
  // reads via this script's table names so a fresh ingest replaces it.
  db.exec(`
    DROP TABLE IF EXISTS lebron_assists_to;
    DROP TABLE IF EXISTS lebron_assisted_by;
    CREATE TABLE lebron_assists_to (
      teammate_player_id INTEGER PRIMARY KEY REFERENCES players(id),
      assists            INTEGER NOT NULL,
      points_off         INTEGER NOT NULL
    );
    CREATE TABLE lebron_assisted_by (
      teammate_player_id INTEGER PRIMARY KEY REFERENCES players(id),
      assists            INTEGER NOT NULL,
      points_off         INTEGER NOT NULL
    );
  `);

  const totalsTo = new Map<number, { assists: number; points: number }>();
  const totalsBy = new Map<number, { assists: number; points: number }>();
  for (const startYear of seasons) {
    const label = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
    console.log(`\nseason ${label}`);
    const csv = await downloadIfMissing(startYear);
    const rows = await processSeason(csv);
    let toCount = 0, byCount = 0, toPts = 0, byPts = 0;
    for (const r of rows) {
      const map = r.direction === "to" ? totalsTo : totalsBy;
      const t = map.get(r.teammateId) ?? { assists: 0, points: 0 };
      t.assists += 1;
      t.points += r.points;
      map.set(r.teammateId, t);
      if (r.direction === "to") { toCount++; toPts += r.points; }
      else { byCount++; byPts += r.points; }
    }
    console.log(`  → LeBron→teammate: ${toCount} ast / ${toPts} pts`);
    console.log(`  → teammate→LeBron: ${byCount} ast / ${byPts} pts`);
  }

  const upsertTo = db.prepare(
    `INSERT INTO lebron_assists_to (teammate_player_id, assists, points_off) VALUES (?, ?, ?)`,
  );
  const upsertBy = db.prepare(
    `INSERT INTO lebron_assisted_by (teammate_player_id, assists, points_off) VALUES (?, ?, ?)`,
  );
  db.transaction(() => {
    for (const [id, t] of totalsTo) upsertTo.run(id, t.assists, t.points);
    for (const [id, t] of totalsBy) upsertBy.run(id, t.assists, t.points);
  })();

  const totalTo = Array.from(totalsTo.values()).reduce((s, t) => s + t.assists, 0);
  const totalBy = Array.from(totalsBy.values()).reduce((s, t) => s + t.assists, 0);
  console.log(`\ntotal: LeBron→ ${totalTo} ast across ${totalsTo.size} teammates`);
  console.log(`       →LeBron ${totalBy} ast from ${totalsBy.size} teammates`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
