/**
 * Loads data/raw/lebron-shots.csv into the existing `shots` table.
 *
 *   npm run seed-shots
 *
 * Idempotent — wipes the shots table first, then bulk-inserts.
 */

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import { openDb } from "../src/lib/db";
import { TEAMS } from "../src/lib/teams";

const CSV_PATH = path.join(process.cwd(), "data", "raw", "lebron-shots.csv");
const DB_PATH = path.join(process.cwd(), "data", "nba.db");

type ShotRow = {
  SEASON_TYPE: string;
  GAME_ID: string;
  GAME_EVENT_ID: string;
  PLAYER_ID: string;
  PLAYER_NAME: string;
  TEAM_ID: string;
  TEAM_NAME: string;
  PERIOD: string;
  MINUTES_REMAINING: string;
  SECONDS_REMAINING: string;
  EVENT_TYPE: string;
  ACTION_TYPE: string;
  SHOT_TYPE: string;
  SHOT_ZONE_BASIC: string;
  SHOT_ZONE_AREA: string;
  SHOT_ZONE_RANGE: string;
  SHOT_DISTANCE: string;
  LOC_X: string;
  LOC_Y: string;
  SHOT_ATTEMPTED_FLAG: string;
  SHOT_MADE_FLAG: string;
  GAME_DATE: string;
  HTM: string;
  VTM: string;
};

function gameDateToIso(s: string): string | null {
  // NBA stats returns dates like "20031029" (YYYYMMDD).
  if (!s || s.length !== 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function seasonOf(isoDate: string | null, gameId: string): string {
  // Prefer date-derived season (Oct→Sep). Fall back to GAME_ID prefix:
  // regular: 002YYXXXXX, playoffs: 004YYXXXXX. The 4th-5th chars are season-start year mod 100.
  if (isoDate) {
    const y = Number(isoDate.slice(0, 4));
    const m = Number(isoDate.slice(5, 7));
    const start = m >= 10 ? y : y - 1;
    return `${start}-${String(start + 1).slice(2)}`;
  }
  if (/^\d{10}$/.test(gameId)) {
    const yy = Number(gameId.slice(3, 5));
    const start = (yy >= 80 ? 1900 : 2000) + yy;
    return `${start}-${String(start + 1).slice(2)}`;
  }
  return "";
}

function findTeamIdByAbbrOrName(abbrOrName: string): number | null {
  const cleaned = abbrOrName?.trim();
  if (!cleaned) return null;
  // Try abbr first (NBA stats sometimes returns "LAL", sometimes the full name).
  const byAbbr = TEAMS.findIndex((t) => t.abbr === cleaned.toUpperCase());
  if (byAbbr >= 0) return byAbbr + 1; // teams are seeded in order — id = index + 1
  // Try full-name / alias match
  const lower = cleaned.toLowerCase();
  const idx = TEAMS.findIndex((t) =>
    t.aliases.some((a) => a.toLowerCase() === lower) ||
    t.fullName.toLowerCase() === lower ||
    t.name.toLowerCase() === lower,
  );
  return idx >= 0 ? idx + 1 : null;
}

function lebronTeamFor(date: string | null): string | null {
  // LeBron's team timeline — used to pick the OPPONENT abbr from {HTM, VTM}.
  if (!date) return null;
  const d = date;
  if (d < "2010-07-08") return "CLE";
  if (d < "2014-07-11") return "MIA";
  if (d < "2018-07-01") return "CLE";
  return "LAL";
}

function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`No CSV at ${CSV_PATH}. Run \`npm run fetch-shots\` first.`);
    process.exit(1);
  }
  const db = openDb(DB_PATH);

  // Sanity-check the players table has LeBron.
  const lebronRow = db.prepare(`SELECT id FROM players WHERE full_name = 'LeBron James'`).get() as { id: number } | undefined;
  if (!lebronRow) {
    console.error("LeBron not found in players table. Run `npm run seed` first.");
    process.exit(1);
  }
  const lebronId = lebronRow.id;

  console.log(`reading ${CSV_PATH} …`);
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const parsed = Papa.parse<ShotRow>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    console.warn(`csv parse warnings: ${parsed.errors.length} (first: ${parsed.errors[0].message})`);
  }
  const rows = parsed.data;
  console.log(`parsed ${rows.length.toLocaleString()} shot rows`);

  // The games table uses unpadded numeric ids ("20300014"). The NBA stats
  // shotchartdetail returns zero-padded 10-digit ids ("0020300014"). Strip
  // the leading zeros and keep only ids that actually exist in our games
  // table — the rest get NULL game_id (preseason / All-Star / Olympics).
  const validGameIds = new Set<string>(
    (db.prepare(`SELECT id FROM games`).all() as { id: string }[]).map((r) => r.id),
  );
  const normalizeGameId = (raw: string): string => raw.replace(/^0+/, "");

  db.exec(`DELETE FROM shots`);
  // Reset autoincrement counter.
  db.prepare(`DELETE FROM sqlite_sequence WHERE name='shots'`).run();

  const insert = db.prepare(`
    INSERT INTO shots (
      player_id, game_id, game_date, season, period,
      minutes_remaining, seconds_remaining, event_type, action_type,
      shot_type, shot_zone_basic, shot_distance, loc_x, loc_y, opponent_team_id
    ) VALUES (
      @player_id, @game_id, @game_date, @season, @period,
      @minutes_remaining, @seconds_remaining, @event_type, @action_type,
      @shot_type, @shot_zone_basic, @shot_distance, @loc_x, @loc_y, @opponent_team_id
    )
  `);

  const insertMany = db.transaction((items: Record<string, unknown>[]) => {
    for (const it of items) insert.run(it);
  });

  // Build payload in chunks so we don't blow memory on the big career.
  const CHUNK = 5000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => {
      const game_date = gameDateToIso(r.GAME_DATE);
      const season = seasonOf(game_date, r.GAME_ID);
      const lebronAbbr = lebronTeamFor(game_date);
      const opp = lebronAbbr === r.HTM ? r.VTM : r.HTM;
      const normalized = r.GAME_ID ? normalizeGameId(r.GAME_ID) : "";
      return {
        player_id: lebronId,
        game_id: normalized && validGameIds.has(normalized) ? normalized : null,
        game_date,
        season,
        period: Number(r.PERIOD) || null,
        minutes_remaining: Number(r.MINUTES_REMAINING) || 0,
        seconds_remaining: Number(r.SECONDS_REMAINING) || 0,
        event_type: r.EVENT_TYPE || null,
        action_type: r.ACTION_TYPE || null,
        shot_type: r.SHOT_TYPE || null,
        shot_zone_basic: r.SHOT_ZONE_BASIC || null,
        shot_distance: Number(r.SHOT_DISTANCE) || 0,
        loc_x: Number(r.LOC_X),
        loc_y: Number(r.LOC_Y),
        opponent_team_id: findTeamIdByAbbrOrName(opp || ""),
      };
    });
    insertMany(chunk);
    inserted += chunk.length;
    process.stdout.write(`  inserted ${inserted.toLocaleString()} / ${rows.length.toLocaleString()}\r`);
  }
  process.stdout.write("\n");

  const made = db.prepare(`SELECT COUNT(*) AS n FROM shots WHERE event_type = 'Made Shot'`).get() as { n: number };
  const total = db.prepare(`SELECT COUNT(*) AS n FROM shots`).get() as { n: number };
  const seasons = db.prepare(`SELECT COUNT(DISTINCT season) AS n FROM shots`).get() as { n: number };
  console.log(`done. ${total.n.toLocaleString()} attempts (${made.n.toLocaleString()} made) across ${seasons.n} seasons.`);
}

main();
