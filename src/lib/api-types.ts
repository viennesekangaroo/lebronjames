// Shape of /public/api/*.json (and matching /api/* route handlers in dev).
//
// These are split out from the route files so client components can import them
// without dragging in better-sqlite3 — important because the API routes are
// excluded from the Vercel deploy via .vercelignore.

export type GameCell = {
  gameId: string;
  date: string;
  minutes: number;
  points: number;
  played: boolean;
  win: 0 | 1 | null;
  oppAbbr: string | null;
  isHome: 0 | 1 | null;
};
export type SeasonRow = {
  season: string;
  teamAbbr: string;
  regular: GameCell[];
  playoffs: GameCell[];
  regularMinutes: number;
  playoffsMinutes: number;
};
export type GamesPayload = {
  seasons: SeasonRow[];
  maxRegularGames: number;
  maxPlayoffGames: number;
  maxMinutes: number;
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
  careerPoints: number;
  careerGames: number;
};

export type FinalsEntry = {
  year: number;
  champion: string;
  championAbbr: string;
  runnerUp: string;
  runnerUpAbbr: string;
  result: string;
  lebron?: {
    team: "champion" | "runnerUp";
    teamAbbr: string;
  };
};
export type FranchiseWins = {
  abbr: string;
  fullName: string;
  playoffWins: number;
};
export type PlayoffsPayload = {
  lebronPlayoffWins: number;
  lebronPlayoffLosses: number;
  lebronFinalsCount: number;
  lebronFinalsWins: number;
  totalFinalsInHistory: number;
  finalsParticipationPct: number;
  finals: FinalsEntry[];
  franchiseWins: FranchiseWins[];
  source: "sqlite-derived + static";
  generatedAt: string;
};

export type ComputedRecords = {
  totalGames: number;
  totalPlayed: number;
  totalDnp: number;
  totalMinutes: number;
  totalPoints: number;
  seasons: number;
  championships: number;
  regGames: number;
  regPlayed: number;
  regWins: number;
  regLosses: number;
  regPoints: number;
  regMinutes: number;
  poGames: number;
  poWins: number;
  poLosses: number;
  poPoints: number;
  poMinutes: number;
  games30plus: number;
  reg30plus: number;
  po30plus: number;
  games40plusMin: number;
  firstGameDate: string;
  lastGameDate: string;
  source: "sqlite-derived";
  generatedAt: string;
};
