/**
 * Patches the seed DB with LeBron's most recent regular-season games from
 * stats.nba.com when the upstream Kaggle CSV lags behind the live calendar.
 *
 *   Run: npm run fetch:recent
 *
 * Pulls the player game log via stats.nba.com/stats/playergamelog, finds rows
 * whose game_date is after our latest seeded LeBron RS game, and inserts them
 * into `appearances` + `games` (and `players`/`teams` if needed).
 *
 * stats.nba.com is unofficial — it returns a row-array shape:
 *   { resultSets: [{ headers: [...], rowSet: [[...], ...] }] }
 * We pin to PlayerID=2544 (LeBron) and SeasonType=Regular Season.
 */
import { openDb } from "../src/lib/db";

const LEBRON_ID = 2544;

// stats.nba.com refuses requests without a "browser-y" set of headers.
const NBA_HEADERS: Record<string, string> = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nba.com",
  Referer: "https://www.nba.com/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

type StatsResponse = {
  resultSets: { name: string; headers: string[]; rowSet: (string | number | null)[][] }[];
};

function seasonLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

async function fetchGameLog(seasonStartYear: number, seasonType: "Regular Season" | "Playoffs" = "Regular Season") {
  const season = seasonLabel(seasonStartYear);
  const url = new URL("https://stats.nba.com/stats/playergamelog");
  url.searchParams.set("PlayerID", String(LEBRON_ID));
  url.searchParams.set("Season", season);
  url.searchParams.set("SeasonType", seasonType);
  url.searchParams.set("LeagueID", "00");

  // stats.nba.com sometimes hangs. Bound each request, retry once on timeout.
  let json: StatsResponse | null = null;
  for (let attempt = 1; attempt <= 3 && !json; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 15_000);
    try {
      const res = await fetch(url, { headers: NBA_HEADERS, signal: ac.signal });
      if (!res.ok) throw new Error(`stats.nba.com ${res.status} ${res.statusText}`);
      json = (await res.json()) as StatsResponse;
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  if (!json) throw new Error("unreachable");
  const set = json.resultSets.find((s) => s.name === "PlayerGameLog");
  if (!set) throw new Error("no PlayerGameLog set in response");
  const idx = Object.fromEntries(set.headers.map((h, i) => [h, i]));
  return set.rowSet.map((row) => ({
    // API returns "0022401185"; the rest of our DB stores it as "22401185".
    gameId: String(row[idx.Game_ID]).replace(/^0+/, ""),
    // GAME_DATE is "MMM DD, YYYY" e.g. "APR 14, 2026". Convert to ISO YYYY-MM-DD.
    gameDate: parseNbaDate(String(row[idx.GAME_DATE])),
    matchup: String(row[idx.MATCHUP]),
    win: String(row[idx.WL]) === "W" ? 1 : 0,
    minutes: Number(row[idx.MIN]) || 0,
    points: Number(row[idx.PTS]) || 0,
    assists: Number(row[idx.AST]) || 0,
  }));
}

function parseNbaDate(s: string): string {
  const months: Record<string, string> = {
    JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
    JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
  };
  const m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (!m) throw new Error(`bad NBA date: ${s}`);
  return `${m[3]}-${months[m[1].toUpperCase()]}-${m[2].padStart(2, "0")}`;
}

// "LAL @ DEN" → opponent abbr "DEN", isHome 0. "LAL vs. DEN" → home, "DEN".
function parseMatchup(matchup: string): { oppAbbr: string; isHome: 0 | 1 } | null {
  const at = matchup.match(/^([A-Z]{3})\s+@\s+([A-Z]{3})$/);
  if (at) return { oppAbbr: at[2], isHome: 0 };
  const home = matchup.match(/^([A-Z]{3})\s+vs\.?\s+([A-Z]{3})$/);
  if (home) return { oppAbbr: home[2], isHome: 1 };
  return null;
}

async function main() {
  const db = openDb();

  // Determine which seasons to inspect: from LeBron's first seeded season through "next season"
  // so we cover both backfill (games dropped from older Kaggle CSVs) and forward (new games).
  const today = new Date();
  const yr = today.getUTCFullYear();
  const currentStart = today.getUTCMonth() >= 9 ? yr : yr - 1;
  const allSeasons: number[] = [];
  for (let sy = 2003; sy <= currentStart + 1; sy++) allSeasons.push(sy);

  // The script accepts --season=YYYY (start year) to limit work.
  const onlyArg = process.argv.slice(2).find((a) => a.startsWith("--season="));
  const seasons = onlyArg ? [parseInt(onlyArg.slice("--season=".length), 10)] : allSeasons;

  const teamByAbbr = new Map(
    (db.prepare(`SELECT id, abbr FROM teams`).all() as { id: number; abbr: string }[]).map((t) => [t.abbr, t.id]),
  );

  // Upsert: if the seed CSV labeled an NBA Cup group-stage game as "NBA Emirates Cup",
  // rewrite it to "Regular Season" — the API counts those games as RS, and so does the
  // canonical career stat. Group-stage Cup games count to RS stats; only the championship
  // game is excluded, but it's flagged separately by the API as not appearing in RS log.
  const insertGame = db.prepare(
    `INSERT INTO games (id, game_date, season, game_type) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET game_type = excluded.game_type`,
  );
  const insertApp = db.prepare(
    `INSERT OR REPLACE INTO appearances (game_id, player_id, team_id, opponent_team_id, is_home, win, minutes, points, assists)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let added = 0;
  for (const sy of seasons) {
    const season = seasonLabel(sy);
    for (const seasonType of ["Regular Season", "Playoffs"] as const) {
      let log: Awaited<ReturnType<typeof fetchGameLog>>;
      try {
        log = await fetchGameLog(sy, seasonType);
      } catch (err) {
        console.warn(`  ${season} ${seasonType}: skipped (${(err as Error).message})`);
        continue;
      }
      if (log.length === 0) continue; // empty before season started, or no playoff appearance

      const seeded = new Set(
        (db
          .prepare(
            `SELECT a.game_id FROM appearances a JOIN games g ON g.id=a.game_id
             WHERE a.player_id = ? AND g.season = ? AND g.game_type = ?`,
          )
          .all(LEBRON_ID, season, seasonType) as { game_id: string }[]).map((r) => r.game_id),
      );
      const missing = log.filter((g) => !seeded.has(g.gameId));
      console.log(`  ${season} ${seasonType}: API ${log.length}g, seeded ${seeded.size}g, missing ${missing.length}g`);
      if (missing.length === 0) continue;

      for (const g of missing) {
        const matchup = parseMatchup(g.matchup);
        if (!matchup) {
          console.warn(`    skip ${g.gameId}: cannot parse matchup "${g.matchup}"`);
          continue;
        }
        const lebronTeamAbbr = g.matchup.slice(0, 3);
        const teamId = teamByAbbr.get(lebronTeamAbbr);
        const oppId = teamByAbbr.get(matchup.oppAbbr);
        if (!teamId || !oppId) {
          console.warn(`    skip ${g.gameId}: unknown team abbr ${lebronTeamAbbr}/${matchup.oppAbbr}`);
          continue;
        }
        insertGame.run(g.gameId, g.gameDate, season, seasonType);
        insertApp.run(g.gameId, LEBRON_ID, teamId, oppId, matchup.isHome, g.win, g.minutes, g.points, g.assists);
        added++;
        console.log(`    + ${g.gameDate} ${seasonType[0]} ${g.matchup}: ${g.points} pts / ${g.assists} ast`);
      }

      await new Promise((r) => setTimeout(r, 600));
    }
  }

  const after = db
    .prepare(
      `SELECT COALESCE(SUM(a.assists),0) AS n
       FROM appearances a JOIN games g ON g.id = a.game_id
       WHERE a.player_id = ? AND a.minutes > 0 AND g.game_type = 'Regular Season'`,
    )
    .get(LEBRON_ID) as { n: number };
  console.log(`\n${added} game(s) added. RS career assists now: ${after.n}`);
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
