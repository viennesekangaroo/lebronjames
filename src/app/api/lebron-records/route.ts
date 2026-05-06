import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Career totals are computed from `appearances` joined to `games`. We only
// count Regular Season + Playoffs (no preseason, no NBA Cup, no Play-in) so
// these match what stats.nba.com reports as "career stats".
//
// Anything that requires award voting, win-shares, VORP, or all-time leader-
// board context (e.g. "+6 over Kareem") can't be derived from this DB and is
// left to the page's static section.

export type ComputedRecords = {
  // Top-line career volume
  totalGames: number;
  totalPlayed: number;
  totalDnp: number;
  totalMinutes: number;
  totalPoints: number;
  seasons: number;
  championships: number;

  // Regular season
  regGames: number;
  regPlayed: number;
  regWins: number;
  regLosses: number;
  regPoints: number;
  regMinutes: number;

  // Playoffs
  poGames: number;
  poWins: number;
  poLosses: number;
  poPoints: number;
  poMinutes: number;

  // Workload markers
  games30plus: number;
  reg30plus: number;
  po30plus: number;
  games40plusMin: number;

  // Career range
  firstGameDate: string;
  lastGameDate: string;

  // Provenance — what these numbers were derived from + when last seeded.
  source: "sqlite-derived";
  generatedAt: string;
};

// LeBron's four championship seasons. Used to compute the ring count from the
// DB (rather than hardcoding "4") so the count auto-updates if/when he wins
// another. Kept here because championship-clincher detection from the data
// alone is fragile (would need to know "was this his team's last playoff
// game *and* did they win it"), and these four are unambiguous public record.
const CHAMPIONSHIP_SEASONS: ReadonlySet<string> = new Set([
  "2011-12",
  "2012-13",
  "2015-16",
  "2019-20",
]);

type CareerRow = {
  total_games: number;
  total_minutes: number;
  total_points: number;
  played: number;
  dnps: number;
  seasons: number;
  reg_games: number;
  reg_played: number;
  reg_wins: number;
  reg_losses: number;
  reg_points: number;
  reg_minutes: number;
  po_games: number;
  po_wins: number;
  po_losses: number;
  po_points: number;
  po_minutes: number;
  reg_30plus: number;
  po_30plus: number;
  games_40plus_min: number;
  first_date: string;
  last_date: string;
};

export async function GET() {
  try {
    const db = getDb();
    const meta = db.prepare(`SELECT value FROM meta WHERE key='lebron_id'`).get() as { value: string } | undefined;
    if (!meta) {
      return NextResponse.json(
        { error: "DB_NOT_SEEDED", message: "Run `npm run seed` first." },
        { status: 503 },
      );
    }
    const lebronId = Number(meta.value);

    const row = db
      .prepare<[number], CareerRow>(
        `WITH lj AS (
           SELECT a.minutes, a.points, a.win, g.season, g.game_type, g.game_date
           FROM appearances a JOIN games g ON g.id = a.game_id
           WHERE a.player_id = ? AND g.game_type IN ('Regular Season', 'Playoffs')
         )
         SELECT
           COUNT(*)                                                              AS total_games,
           COALESCE(ROUND(SUM(minutes), 0), 0)                                   AS total_minutes,
           COALESCE(SUM(points), 0)                                              AS total_points,
           SUM(CASE WHEN minutes > 0 THEN 1 ELSE 0 END)                          AS played,
           SUM(CASE WHEN minutes IS NULL OR minutes = 0 THEN 1 ELSE 0 END)       AS dnps,
           COUNT(DISTINCT season)                                                AS seasons,
           SUM(CASE WHEN game_type='Regular Season' THEN 1 ELSE 0 END)           AS reg_games,
           SUM(CASE WHEN game_type='Regular Season' AND minutes>0 THEN 1 ELSE 0 END) AS reg_played,
           SUM(CASE WHEN game_type='Regular Season' AND win=1 AND minutes>0 THEN 1 ELSE 0 END) AS reg_wins,
           SUM(CASE WHEN game_type='Regular Season' AND win=0 AND minutes>0 THEN 1 ELSE 0 END) AS reg_losses,
           COALESCE(SUM(CASE WHEN game_type='Regular Season' THEN points ELSE 0 END), 0) AS reg_points,
           COALESCE(ROUND(SUM(CASE WHEN game_type='Regular Season' THEN minutes ELSE 0 END), 0), 0) AS reg_minutes,
           SUM(CASE WHEN game_type='Playoffs' THEN 1 ELSE 0 END)                 AS po_games,
           SUM(CASE WHEN game_type='Playoffs' AND win=1 AND minutes>0 THEN 1 ELSE 0 END) AS po_wins,
           SUM(CASE WHEN game_type='Playoffs' AND win=0 AND minutes>0 THEN 1 ELSE 0 END) AS po_losses,
           COALESCE(SUM(CASE WHEN game_type='Playoffs' THEN points ELSE 0 END), 0) AS po_points,
           COALESCE(ROUND(SUM(CASE WHEN game_type='Playoffs' THEN minutes ELSE 0 END), 0), 0) AS po_minutes,
           SUM(CASE WHEN game_type='Regular Season' AND points>=30 THEN 1 ELSE 0 END) AS reg_30plus,
           SUM(CASE WHEN game_type='Playoffs' AND points>=30 THEN 1 ELSE 0 END)  AS po_30plus,
           SUM(CASE WHEN minutes>=40 THEN 1 ELSE 0 END)                          AS games_40plus_min,
           MIN(game_date)                                                        AS first_date,
           MAX(game_date)                                                        AS last_date
         FROM lj`,
      )
      .get(lebronId);

    if (!row) {
      return NextResponse.json({ error: "DB_ERROR", message: "No data for LeBron." }, { status: 500 });
    }

    // Championships intersect: which of the user's champion seasons appear in
    // the DB? We don't try to verify a Finals win from PBP — these four are
    // public record.
    const presentSeasons = db
      .prepare<[number], { season: string }>(
        `SELECT DISTINCT season FROM appearances a JOIN games g ON g.id=a.game_id
         WHERE a.player_id=? AND g.game_type='Playoffs'`,
      )
      .all(lebronId)
      .map((r) => r.season);
    const championships = presentSeasons.filter((s) => CHAMPIONSHIP_SEASONS.has(s)).length;

    const payload: ComputedRecords = {
      totalGames: row.total_games,
      totalPlayed: row.played,
      totalDnp: row.dnps,
      totalMinutes: row.total_minutes,
      totalPoints: row.total_points,
      seasons: row.seasons,
      championships,

      regGames: row.reg_games,
      regPlayed: row.reg_played,
      regWins: row.reg_wins,
      regLosses: row.reg_losses,
      regPoints: row.reg_points,
      regMinutes: row.reg_minutes,

      poGames: row.po_games,
      poWins: row.po_wins,
      poLosses: row.po_losses,
      poPoints: row.po_points,
      poMinutes: row.po_minutes,

      games30plus: row.reg_30plus + row.po_30plus,
      reg30plus: row.reg_30plus,
      po30plus: row.po_30plus,
      games40plusMin: row.games_40plus_min,

      firstGameDate: row.first_date,
      lastGameDate: row.last_date,

      source: "sqlite-derived",
      generatedAt: new Date().toISOString(),
    };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: "DB_ERROR", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
