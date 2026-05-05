export type TeamMeta = {
  abbr: string;
  city: string;
  name: string;
  fullName: string;
  primary: string;
  secondary: string;
  // ESPN URL slug for logos at https://a.espn.com/i/teamlogos/nba/500/<espn>.png
  espn: string;
  // aliases used in source CSVs (full names + previous franchise names)
  aliases: string[];
};

// Tailored to LeBron's career (2003–present). Includes franchises that
// renamed/relocated during this window (Sonics, Bobcats, NJ Nets, NO Hornets).
// Primary colors are saturated picks tuned for the dark-canvas aesthetic.
export const TEAMS: TeamMeta[] = [
  { abbr: "ATL", city: "Atlanta", name: "Hawks", fullName: "Atlanta Hawks", primary: "#E03A3E", secondary: "#C1D32F", espn: "atl", aliases: ["Atlanta Hawks"] },
  { abbr: "BOS", city: "Boston", name: "Celtics", fullName: "Boston Celtics", primary: "#007A33", secondary: "#BA9653", espn: "bos", aliases: ["Boston Celtics"] },
  { abbr: "BKN", city: "Brooklyn", name: "Nets", fullName: "Brooklyn Nets", primary: "#FFFFFF", secondary: "#000000", espn: "bkn", aliases: ["Brooklyn Nets", "New Jersey Nets"] },
  { abbr: "CHA", city: "Charlotte", name: "Hornets", fullName: "Charlotte Hornets", primary: "#1D1160", secondary: "#00788C", espn: "cha", aliases: ["Charlotte Hornets", "Charlotte Bobcats"] },
  { abbr: "CHI", city: "Chicago", name: "Bulls", fullName: "Chicago Bulls", primary: "#CE1141", secondary: "#000000", espn: "chi", aliases: ["Chicago Bulls"] },
  { abbr: "CLE", city: "Cleveland", name: "Cavaliers", fullName: "Cleveland Cavaliers", primary: "#860038", secondary: "#FDBB30", espn: "cle", aliases: ["Cleveland Cavaliers"] },
  { abbr: "DAL", city: "Dallas", name: "Mavericks", fullName: "Dallas Mavericks", primary: "#00538C", secondary: "#B8C4CA", espn: "dal", aliases: ["Dallas Mavericks"] },
  { abbr: "DEN", city: "Denver", name: "Nuggets", fullName: "Denver Nuggets", primary: "#0E2240", secondary: "#FEC524", espn: "den", aliases: ["Denver Nuggets"] },
  { abbr: "DET", city: "Detroit", name: "Pistons", fullName: "Detroit Pistons", primary: "#C8102E", secondary: "#1D42BA", espn: "det", aliases: ["Detroit Pistons"] },
  { abbr: "GSW", city: "Golden State", name: "Warriors", fullName: "Golden State Warriors", primary: "#1D428A", secondary: "#FFC72C", espn: "gs", aliases: ["Golden State Warriors"] },
  { abbr: "HOU", city: "Houston", name: "Rockets", fullName: "Houston Rockets", primary: "#CE1141", secondary: "#000000", espn: "hou", aliases: ["Houston Rockets"] },
  { abbr: "IND", city: "Indiana", name: "Pacers", fullName: "Indiana Pacers", primary: "#002D62", secondary: "#FDBB30", espn: "ind", aliases: ["Indiana Pacers"] },
  { abbr: "LAC", city: "Los Angeles", name: "Clippers", fullName: "LA Clippers", primary: "#C8102E", secondary: "#1D428A", espn: "lac", aliases: ["LA Clippers", "Los Angeles Clippers"] },
  { abbr: "LAL", city: "Los Angeles", name: "Lakers", fullName: "Los Angeles Lakers", primary: "#552583", secondary: "#FDB927", espn: "lal", aliases: ["Los Angeles Lakers"] },
  { abbr: "MEM", city: "Memphis", name: "Grizzlies", fullName: "Memphis Grizzlies", primary: "#5D76A9", secondary: "#12173F", espn: "mem", aliases: ["Memphis Grizzlies"] },
  { abbr: "MIA", city: "Miami", name: "Heat", fullName: "Miami Heat", primary: "#98002E", secondary: "#F9A01B", espn: "mia", aliases: ["Miami Heat"] },
  { abbr: "MIL", city: "Milwaukee", name: "Bucks", fullName: "Milwaukee Bucks", primary: "#00471B", secondary: "#EEE1C6", espn: "mil", aliases: ["Milwaukee Bucks"] },
  { abbr: "MIN", city: "Minnesota", name: "Timberwolves", fullName: "Minnesota Timberwolves", primary: "#0C2340", secondary: "#236192", espn: "min", aliases: ["Minnesota Timberwolves"] },
  { abbr: "NOP", city: "New Orleans", name: "Pelicans", fullName: "New Orleans Pelicans", primary: "#0C2340", secondary: "#C8102E", espn: "no", aliases: ["New Orleans Pelicans", "New Orleans Hornets", "New Orleans/Oklahoma City Hornets"] },
  { abbr: "NYK", city: "New York", name: "Knicks", fullName: "New York Knicks", primary: "#006BB6", secondary: "#F58426", espn: "ny", aliases: ["New York Knicks"] },
  { abbr: "OKC", city: "Oklahoma City", name: "Thunder", fullName: "Oklahoma City Thunder", primary: "#007AC1", secondary: "#EF3B24", espn: "okc", aliases: ["Oklahoma City Thunder", "Seattle SuperSonics"] },
  { abbr: "ORL", city: "Orlando", name: "Magic", fullName: "Orlando Magic", primary: "#0077C0", secondary: "#C4CED4", espn: "orl", aliases: ["Orlando Magic"] },
  { abbr: "PHI", city: "Philadelphia", name: "76ers", fullName: "Philadelphia 76ers", primary: "#006BB6", secondary: "#ED174C", espn: "phi", aliases: ["Philadelphia 76ers"] },
  { abbr: "PHX", city: "Phoenix", name: "Suns", fullName: "Phoenix Suns", primary: "#1D1160", secondary: "#E56020", espn: "phx", aliases: ["Phoenix Suns"] },
  { abbr: "POR", city: "Portland", name: "Trail Blazers", fullName: "Portland Trail Blazers", primary: "#E03A3E", secondary: "#000000", espn: "por", aliases: ["Portland Trail Blazers"] },
  { abbr: "SAC", city: "Sacramento", name: "Kings", fullName: "Sacramento Kings", primary: "#5A2D81", secondary: "#63727A", espn: "sac", aliases: ["Sacramento Kings"] },
  { abbr: "SAS", city: "San Antonio", name: "Spurs", fullName: "San Antonio Spurs", primary: "#C4CED4", secondary: "#000000", espn: "sa", aliases: ["San Antonio Spurs"] },
  { abbr: "TOR", city: "Toronto", name: "Raptors", fullName: "Toronto Raptors", primary: "#CE1141", secondary: "#000000", espn: "tor", aliases: ["Toronto Raptors"] },
  { abbr: "UTA", city: "Utah", name: "Jazz", fullName: "Utah Jazz", primary: "#002B5C", secondary: "#F9A01B", espn: "utah", aliases: ["Utah Jazz"] },
  { abbr: "WAS", city: "Washington", name: "Wizards", fullName: "Washington Wizards", primary: "#002B5C", secondary: "#E31837", espn: "wsh", aliases: ["Washington Wizards"] },
];

export function logoUrl(team: TeamMeta): string {
  return `https://cdn.nba.com/logos/nba/${nbaCdnId(team.abbr)}/primary/L/logo.svg`;
}

function nbaCdnId(abbr: string): number {
  const map: Record<string, number> = {
    ATL: 1610612737, BOS: 1610612738, BKN: 1610612751, CHA: 1610612766,
    CHI: 1610612741, CLE: 1610612739, DAL: 1610612742, DEN: 1610612743,
    DET: 1610612765, GSW: 1610612744, HOU: 1610612745, IND: 1610612754,
    LAC: 1610612746, LAL: 1610612747, MEM: 1610612763, MIA: 1610612748,
    MIL: 1610612749, MIN: 1610612750, NOP: 1610612740, NYK: 1610612752,
    OKC: 1610612760, ORL: 1610612753, PHI: 1610612755, PHX: 1610612756,
    POR: 1610612757, SAC: 1610612758, SAS: 1610612759, TOR: 1610612761,
    UTA: 1610612762, WAS: 1610612764,
  };
  return map[abbr] ?? 1610612737;
}

const aliasIndex = new Map<string, TeamMeta>();
for (const team of TEAMS) {
  aliasIndex.set(team.fullName.toLowerCase(), team);
  aliasIndex.set(team.abbr.toLowerCase(), team);
  for (const alias of team.aliases) aliasIndex.set(alias.toLowerCase(), team);
}

export function findTeam(query: string | null | undefined): TeamMeta | undefined {
  if (!query) return undefined;
  return aliasIndex.get(query.trim().toLowerCase());
}

export function findTeamByCityAndName(city: string | null | undefined, name: string | null | undefined): TeamMeta | undefined {
  if (!city && !name) return undefined;
  const composed = `${(city ?? "").trim()} ${(name ?? "").trim()}`.trim();
  return findTeam(composed) ?? findTeam(name) ?? findTeam(city);
}

export const LEBRON_NAME = { firstName: "LeBron", lastName: "James" } as const;
