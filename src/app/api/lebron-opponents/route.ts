import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One row = one (player × team) pairing across all of LeBron's games.
// Players who played for multiple opposing teams against LeBron get multiple rows.
type OpponentRow = {
  player_id: number;
  full_name: string;
  team_id: number;
  team_abbr: string;
  team_full_name: string;
  primary_color: string;
  secondary_color: string;
  games_faced: number;
  lebron_wins: number;
  lebron_losses: number;
  first_faced: string;
  last_faced: string;
};

export async function GET() {
  try {
    const db = getDb();
    const meta = db.prepare(`SELECT value FROM meta WHERE key = 'lebron_id'`).get() as { value: string } | undefined;
    if (!meta) {
      return NextResponse.json(
        { error: "DB_NOT_SEEDED", message: "Database not seeded yet. Run `npm run seed` after dropping PlayerStatistics.csv into data/raw/." },
        { status: 503 },
      );
    }
    const lebronId = Number(meta.value);

    // "Faced" = both players actually got minutes on the floor (filters DNPs / inactive entries).
    // For each opponent (player, team), compute games faced + LeBron's W/L outcome in those games.
    // Note: appearances.win = 1 means the row's TEAM won that game. Since the opponent's team is
    // what we're querying, opponent.win=0 ⇒ LeBron won, opponent.win=1 ⇒ LeBron lost.
    const rows = db
      .prepare<[number, number], OpponentRow>(
        `WITH lebron_games AS (
           SELECT game_id, team_id AS lebron_team_id
           FROM appearances
           WHERE player_id = ? AND minutes > 0
         )
         SELECT a.player_id,
                p.full_name,
                a.team_id,
                t.abbr                                         AS team_abbr,
                t.full_name                                    AS team_full_name,
                t.primary_color,
                t.secondary_color,
                COUNT(*)                                       AS games_faced,
                SUM(CASE WHEN a.win = 0 THEN 1 ELSE 0 END)     AS lebron_wins,
                SUM(CASE WHEN a.win = 1 THEN 1 ELSE 0 END)     AS lebron_losses,
                MIN(g.game_date)                               AS first_faced,
                MAX(g.game_date)                               AS last_faced
         FROM appearances a
         JOIN games   g  ON g.id = a.game_id
         JOIN players p  ON p.id = a.player_id
         JOIN teams   t  ON t.id = a.team_id
         JOIN lebron_games lg ON lg.game_id = a.game_id
         WHERE a.team_id != lg.lebron_team_id
           AND a.minutes > 0
           AND a.player_id != ?
         GROUP BY a.player_id, a.team_id
         HAVING games_faced > 0
         ORDER BY games_faced DESC`,
      )
      .all(lebronId, lebronId);

    // Distinct opponents (collapse same player across teams).
    const distinctOpponents = new Set<number>();
    for (const r of rows) distinctOpponents.add(r.player_id);

    // Aggregate teams (one anchor per team, sized by player count).
    const teams = new Map<
      number,
      { id: number; abbr: string; fullName: string; color: string; secondary: string; size: number; playerIds: Set<number> }
    >();
    for (const r of rows) {
      const t =
        teams.get(r.team_id) ??
        {
          id: r.team_id,
          abbr: r.team_abbr,
          fullName: r.team_full_name,
          color: r.primary_color,
          secondary: r.secondary_color,
          size: 0,
          playerIds: new Set<number>(),
        };
      t.playerIds.add(r.player_id);
      t.size = t.playerIds.size;
      teams.set(r.team_id, t);
    }

    const lebronGames = db
      .prepare(`SELECT COUNT(*) AS n FROM appearances WHERE player_id = ? AND minutes > 0`)
      .get(lebronId) as { n: number };
    const totalPlayers = db
      .prepare(`SELECT COUNT(DISTINCT player_id) AS n FROM appearances WHERE minutes > 0`)
      .get() as { n: number };

    // Collapse multi-team rows into one entry per opponent — fewer, more meaningful dots.
    type Agg = {
      playerId: number;
      name: string;
      games: number;
      wins: number;
      losses: number;
      first: string;
      last: string;
      teams: { teamId: number; abbr: string; fullName: string; games: number; firstFaced: string; lastFaced: string }[];
    };
    const byPlayer = new Map<number, Agg>();
    for (const r of rows) {
      const a =
        byPlayer.get(r.player_id) ??
        ({ playerId: r.player_id, name: r.full_name, games: 0, wins: 0, losses: 0, first: r.first_faced, last: r.last_faced, teams: [] } as Agg);
      a.games += r.games_faced;
      a.wins += r.lebron_wins;
      a.losses += r.lebron_losses;
      if (r.first_faced < a.first) a.first = r.first_faced;
      if (r.last_faced > a.last) a.last = r.last_faced;
      a.teams.push({
        teamId: r.team_id,
        abbr: r.team_abbr,
        fullName: r.team_full_name,
        games: r.games_faced,
        firstFaced: r.first_faced,
        lastFaced: r.last_faced,
      });
      byPlayer.set(r.player_id, a);
    }
    const opponents = Array.from(byPlayer.values());

    const nodes = [
      { id: "lebron", kind: "self" as const, name: "LeBron James", radius: 36 },
      ...opponents.map((o) => ({
        id: `p:${o.playerId}`,
        kind: "player" as const,
        playerId: o.playerId,
        name: o.name,
        // Wider size range than before: most opponents tiny, frequent foes clearly bigger.
        radius: 1.6 + Math.pow(o.games, 0.72) * 1.1,
        games: o.games,
        wins: o.wins,
        losses: o.losses,
        firstFaced: o.first,
        lastFaced: o.last,
        teams: o.teams.sort((a, b) => b.games - a.games),
      })),
    ];

    const links = opponents.map((o) => ({
      source: "lebron",
      target: `p:${o.playerId}`,
      games: o.games,
    }));

    // Historical franchise count: the seed collapses renames into the current
    // canonical team (BKN holds Brooklyn + NJ Nets, etc.). We add the rename
    // count back per faced franchise so the stat reflects league history.
    const RENAMES_DURING_LEBRON_ERA: Record<string, number> = {
      BKN: 1, // + New Jersey Nets
      CHA: 1, // + Charlotte Bobcats
      NOP: 2, // + New Orleans Hornets, + New Orleans/Oklahoma City Hornets
      OKC: 1, // + Seattle SuperSonics
    };
    let extraHistorical = 0;
    for (const t of teams.values()) extraHistorical += RENAMES_DURING_LEBRON_ERA[t.abbr] ?? 0;
    const historicalFranchisesFaced = teams.size + extraHistorical;

    return NextResponse.json({
      nodes,
      links,
      stats: {
        lebronGames: lebronGames.n,
        opponentsFaced: distinctOpponents.size,
        playerTeamPairings: rows.length,
        teamsFaced: teams.size,
        historicalFranchisesFaced,
        totalPlayers: totalPlayers.n,
        shareOfHistory: totalPlayers.n ? distinctOpponents.size / totalPlayers.n : 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[/api/lebron-opponents]", err);
    return NextResponse.json({ error: "DB_ERROR", message }, { status: 500 });
  }
}
