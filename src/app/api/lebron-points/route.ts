import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CellRow = {
  season: string;
  team_abbr: string;
  game_minute: number;
  points: number;
  events: number;
};
type SeasonRow = {
  season: string;
  team_abbr: string;
  total_points: number;
  total_events: number;
  games: number;
};

export type MinuteCell = { minute: number; points: number; events: number };
export type SeasonRollup = {
  season: string;
  teamAbbr: string;
  totalPoints: number;
  totalEvents: number;
  games: number;
  byMinute: MinuteCell[];
};
export type PointsPayload = {
  seasons: SeasonRollup[];
  maxCellPoints: number;
  maxMinute: number;
};

export async function GET() {
  try {
    const db = getDb();

    const probe = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lebron_scoring_events'")
      .get();
    if (!probe) {
      return NextResponse.json(
        {
          error: "PBP_NOT_INGESTED",
          message: "Play-by-play not ingested yet. Run `npm run ingest:pbp`.",
        },
        { status: 503 },
      );
    }

    // Each row of `lebron_scoring_events` is a single made-FG or made-FT event.
    // A season can have at most one team_abbr after the trade-deadline rule
    // (LeBron has never been mid-season traded), so primary-team-per-season is
    // the team with the most events.
    const cells = db
      .prepare<[], CellRow>(
        `SELECT season,
                COALESCE(t.abbr, '?')                AS team_abbr,
                game_minute,
                SUM(points)                          AS points,
                COUNT(*)                             AS events
         FROM lebron_scoring_events l
         LEFT JOIN teams t ON t.id = l.team_id
         GROUP BY season, team_abbr, game_minute
         ORDER BY season, game_minute`,
      )
      .all();

    const seasonRows = db
      .prepare<[], SeasonRow>(
        `WITH per_team AS (
           SELECT season,
                  COALESCE(t.abbr, '?') AS team_abbr,
                  SUM(points)           AS total_points,
                  COUNT(*)              AS total_events,
                  COUNT(DISTINCT game_id) AS games
           FROM lebron_scoring_events l
           LEFT JOIN teams t ON t.id = l.team_id
           GROUP BY season, team_abbr
         ),
         ranked AS (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY season ORDER BY total_events DESC) AS rk
           FROM per_team
         )
         SELECT season, team_abbr, total_points, total_events, games
         FROM ranked WHERE rk = 1 ORDER BY season`,
      )
      .all();

    const bySeason = new Map<string, SeasonRollup>();
    for (const s of seasonRows) {
      bySeason.set(s.season, {
        season: s.season,
        teamAbbr: s.team_abbr,
        totalPoints: s.total_points,
        totalEvents: s.total_events,
        games: s.games,
        byMinute: [],
      });
    }
    for (const c of cells) {
      const row = bySeason.get(c.season);
      if (!row) continue;
      // only keep cells from the season's primary team
      if (c.team_abbr !== row.teamAbbr) continue;
      row.byMinute.push({ minute: c.game_minute, points: c.points, events: c.events });
    }

    let maxCellPoints = 0;
    let maxMinute = 48;
    for (const s of bySeason.values()) {
      for (const m of s.byMinute) {
        if (m.points > maxCellPoints) maxCellPoints = m.points;
        if (m.minute > maxMinute) maxMinute = m.minute;
      }
    }

    const payload: PointsPayload = {
      seasons: Array.from(bySeason.values()),
      maxCellPoints,
      maxMinute,
    };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: "DB_ERROR", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
