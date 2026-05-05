// One entry per (franchise, era) — splits BKN, CHA, NOP, OKC into the
// historical names they wore during LeBron's career so the team filter can
// treat NJ Nets, Sonics, Bobcats, etc. as distinct from their modern selves.

export type TeamEra = {
  id: string;
  abbr: string;
  label: string;
  // Inclusive ISO bounds. Omitted = unbounded on that end.
  from?: string;
  to?: string;
};

export const TEAM_ERAS: TeamEra[] = [
  { id: "ATL", abbr: "ATL", label: "Atlanta Hawks" },
  { id: "BKN-bk", abbr: "BKN", label: "Brooklyn Nets", from: "2012-08-01" },
  { id: "BKN-nj", abbr: "BKN", label: "New Jersey Nets", to: "2012-07-31" },
  { id: "BOS", abbr: "BOS", label: "Boston Celtics" },
  { id: "CHA-h", abbr: "CHA", label: "Charlotte Hornets", from: "2014-05-20" },
  { id: "CHA-b", abbr: "CHA", label: "Charlotte Bobcats", to: "2014-05-19" },
  { id: "CHI", abbr: "CHI", label: "Chicago Bulls" },
  { id: "CLE", abbr: "CLE", label: "Cleveland Cavaliers" },
  { id: "DAL", abbr: "DAL", label: "Dallas Mavericks" },
  { id: "DEN", abbr: "DEN", label: "Denver Nuggets" },
  { id: "DET", abbr: "DET", label: "Detroit Pistons" },
  { id: "GSW", abbr: "GSW", label: "Golden State Warriors" },
  { id: "HOU", abbr: "HOU", label: "Houston Rockets" },
  { id: "IND", abbr: "IND", label: "Indiana Pacers" },
  { id: "LAC", abbr: "LAC", label: "LA Clippers" },
  { id: "LAL", abbr: "LAL", label: "Los Angeles Lakers" },
  { id: "MEM", abbr: "MEM", label: "Memphis Grizzlies" },
  { id: "MIA", abbr: "MIA", label: "Miami Heat" },
  { id: "MIL", abbr: "MIL", label: "Milwaukee Bucks" },
  { id: "MIN", abbr: "MIN", label: "Minnesota Timberwolves" },
  { id: "NOP-pel", abbr: "NOP", label: "New Orleans Pelicans", from: "2013-04-19" },
  { id: "NOP-noh", abbr: "NOP", label: "New Orleans Hornets", to: "2013-04-18" },
  { id: "NOP-nokc", abbr: "NOP", label: "New Orleans/Oklahoma City Hornets", from: "2005-09-01", to: "2007-06-30" },
  { id: "NYK", abbr: "NYK", label: "New York Knicks" },
  { id: "OKC-thu", abbr: "OKC", label: "Oklahoma City Thunder", from: "2008-09-01" },
  { id: "OKC-son", abbr: "OKC", label: "Seattle SuperSonics", to: "2008-08-31" },
  { id: "ORL", abbr: "ORL", label: "Orlando Magic" },
  { id: "PHI", abbr: "PHI", label: "Philadelphia 76ers" },
  { id: "PHX", abbr: "PHX", label: "Phoenix Suns" },
  { id: "POR", abbr: "POR", label: "Portland Trail Blazers" },
  { id: "SAC", abbr: "SAC", label: "Sacramento Kings" },
  { id: "SAS", abbr: "SAS", label: "San Antonio Spurs" },
  { id: "TOR", abbr: "TOR", label: "Toronto Raptors" },
  { id: "UTA", abbr: "UTA", label: "Utah Jazz" },
  { id: "WAS", abbr: "WAS", label: "Washington Wizards" },
];

export function eraMatches(
  team: { abbr: string; firstFaced: string; lastFaced: string },
  era: TeamEra,
): boolean {
  if (team.abbr !== era.abbr) return false;
  const eraFrom = era.from ?? "0000-01-01";
  const eraTo = era.to ?? "9999-12-31";
  return team.firstFaced <= eraTo && team.lastFaced >= eraFrom;
}
