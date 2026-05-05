// Team-themed accent colors for the most iconic players LeBron has faced.
// Anyone not in this list renders in the default off-white. Names are matched
// after stripping diacritics + casefolding so the source spelling doesn't matter.

const RAW: Record<string, string> = {
  // Lakers / Warriors / Thunder
  "Kobe Bryant": "#552583", // Lakers purple
  "Stephen Curry": "#1D428A", // Warriors royal blue
  "Klay Thompson": "#1D428A",
  "Draymond Green": "#1D428A",
  "Kevin Durant": "#007AC1", // OKC blue (his iconic franchise)
  "Russell Westbrook": "#007AC1",
  // Nuggets / Bucks / Sixers / Mavericks / Celtics
  "Nikola Jokic": "#FEC524", // Nuggets gold
  "Giannis Antetokounmpo": "#00471B", // Bucks green
  "Joel Embiid": "#006BB6", // Sixers royal
  "Allen Iverson": "#ED174C", // Sixers red — distinct from Embiid
  "Luka Doncic": "#00538C", // Mavs blue
  "Dirk Nowitzki": "#00538C",
  "Jayson Tatum": "#007A33", // Celtics green
  "Paul Pierce": "#007A33",
  // Heat / Suns / Rockets / Blazers / Wolves
  "Dwyane Wade": "#98002E", // Heat red
  "Steve Nash": "#E56020", // Suns orange
  "Devin Booker": "#E56020",
  "James Harden": "#CE1141", // Rockets red
  "Yao Ming": "#CE1141",
  "Damian Lillard": "#E03A3E", // Blazers red
  "Kevin Garnett": "#236192", // Wolves blue
};

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

const LOOKUP = new Map(Object.entries(RAW).map(([k, v]) => [normalize(k), v]));

export function getStarColor(name: string): string | null {
  return LOOKUP.get(normalize(name)) ?? null;
}
