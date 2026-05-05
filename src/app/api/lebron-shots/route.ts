import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Single payload of every LeBron shot, sorted chronologically. The shots table
// is ~37k rows — JSON gzips down to a few hundred KB so a single fetch is fine.
type Row = {
  game_date: string;
  season: string;
  period: number;
  minutes_remaining: number;
  seconds_remaining: number;
  loc_x: number;
  loc_y: number;
  made: number; // 1/0
  shot_type: string | null;
  shot_distance: number | null;
  shot_zone_basic: string | null;
  opp_abbr: string | null;
};

export async function GET() {
  try {
    const db = getDb();
    const meta = db.prepare(`SELECT COUNT(*) AS n FROM shots`).get() as { n: number };
    if (!meta.n) {
      return NextResponse.json(
        {
          error: "DB_NOT_SEEDED",
          message: "Shots table empty. Run `npm run fetch-shots` then `npm run seed-shots`.",
        },
        { status: 503 },
      );
    }

    const rows = db
      .prepare<[], Row>(
        `SELECT
           s.game_date            AS game_date,
           s.season               AS season,
           s.period               AS period,
           s.minutes_remaining    AS minutes_remaining,
           s.seconds_remaining    AS seconds_remaining,
           s.loc_x                AS loc_x,
           s.loc_y                AS loc_y,
           CASE WHEN s.event_type = 'Made Shot' THEN 1 ELSE 0 END AS made,
           s.shot_type            AS shot_type,
           s.shot_distance        AS shot_distance,
           s.shot_zone_basic      AS shot_zone_basic,
           t.abbr                 AS opp_abbr
         FROM shots s
         LEFT JOIN teams t ON t.id = s.opponent_team_id
         ORDER BY s.game_date,
                  s.period,
                  -- earlier in the period = higher remaining time
                  (s.minutes_remaining * 60 + s.seconds_remaining) DESC,
                  s.id`,
      )
      .all();

    const totals = db
      .prepare(
        `SELECT
           COUNT(*) AS attempts,
           SUM(CASE WHEN event_type='Made Shot' THEN 1 ELSE 0 END) AS made
         FROM shots`,
      )
      .get() as { attempts: number; made: number };

    const seasons = db
      .prepare(`SELECT DISTINCT season FROM shots ORDER BY season`)
      .all() as { season: string }[];

    const opps = db
      .prepare<[], { abbr: string; full_name: string; first: string; last: string; n: number }>(
        `SELECT t.abbr, t.full_name,
                MIN(s.game_date) AS first,
                MAX(s.game_date) AS last,
                COUNT(*) AS n
           FROM shots s
           JOIN teams t ON t.id = s.opponent_team_id
          GROUP BY t.id
          ORDER BY t.abbr`,
      )
      .all();

    return NextResponse.json({
      shots: rows,
      stats: {
        attempts: totals.attempts,
        made: totals.made,
        seasons: seasons.map((s) => s.season),
        opponents: opps,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/lebron-shots]", err);
    return NextResponse.json({ error: "DB_ERROR", message }, { status: 500 });
  }
}
