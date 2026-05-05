/**
 * Ingests LeBron James's assists from the same NBA Stats PBP CSVs used by
 * `ingest-pbp.ts` (shufinskiy/nba_data) and writes per-teammate aggregates
 * to a `lebron_assists_to` table:
 *
 *   scorer_player_id  INTEGER  — players.id of the assisted teammate
 *   assists           INTEGER  — count of made FGs LeBron assisted on
 *   points_off        INTEGER  — points scored by the teammate on those FGs (2 or 3)
 *
 *   Run: npm run ingest:assists
 *
 * Detection: EVENTMSGTYPE=1 (made FG) AND PLAYER2_ID = 2544 (LeBron). For made
 * FGs the secondary player slot is the assister; PLAYER1 is the scorer.
 * Points-on-event come from the running "(N PTS)" total in the description,
 * same trick as ingest-pbp.ts.
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

type Row = { scorerId: number; points: number };

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
    if (cols[idx.PLAYER2_ID] !== LEBRON_PERSON_ID) continue; // LeBron is the assister

    const home = cols[idx.HOMEDESCRIPTION] ?? "";
    const visitor = cols[idx.VISITORDESCRIPTION] ?? "";
    const desc = home || visitor;
    if (!desc) continue;

    const scorerIdStr = cols[idx.PLAYER1_ID];
    const scorerId = parseInt(scorerIdStr, 10);
    if (!Number.isFinite(scorerId) || scorerId <= 0) continue;
    if (scorerIdStr === LEBRON_PERSON_ID) continue; // safety

    // Made FGs are 2 or 3 points; "3PT" appears in the description for threes.
    const points = /\b3PT\b/.test(desc) ? 3 : 2;
    out.push({ scorerId, points });
  }
  return out;
}

async function main() {
  const onlyArg = process.argv.slice(2).find((a) => a.startsWith("--season="));
  const seasons = onlyArg ? [parseInt(onlyArg.slice("--season=".length), 10)] : SEASONS;

  const db = openDb(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS lebron_assists_to (
      scorer_player_id INTEGER PRIMARY KEY REFERENCES players(id),
      assists          INTEGER NOT NULL,
      points_off       INTEGER NOT NULL
    );
  `);

  const totals = new Map<number, { assists: number; points: number }>();
  for (const startYear of seasons) {
    const label = `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
    console.log(`\nseason ${label}`);
    const csv = await downloadIfMissing(startYear);
    const rows = await processSeason(csv);
    for (const r of rows) {
      const t = totals.get(r.scorerId) ?? { assists: 0, points: 0 };
      t.assists += 1;
      t.points += r.points;
      totals.set(r.scorerId, t);
    }
    const seasonAst = rows.length;
    const seasonPts = rows.reduce((s, r) => s + r.points, 0);
    console.log(`  → ${seasonAst} assists, ${seasonPts} points off them`);
  }

  // If running with --season=, merge into existing rows; otherwise replace all.
  const isFullRun = !onlyArg;
  const upsert = db.prepare(
    `INSERT INTO lebron_assists_to (scorer_player_id, assists, points_off)
     VALUES (?, ?, ?)
     ON CONFLICT(scorer_player_id) DO UPDATE SET
       assists    = excluded.assists,
       points_off = excluded.points_off`,
  );
  const tx = db.transaction(() => {
    if (isFullRun) db.exec("DELETE FROM lebron_assists_to");
    for (const [scorerId, t] of totals) {
      upsert.run(scorerId, t.assists, t.points);
    }
  });
  tx();

  const total = Array.from(totals.values()).reduce((s, t) => s + t.assists, 0);
  console.log(`\ntotal: ${total} assists across ${totals.size} teammates`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
