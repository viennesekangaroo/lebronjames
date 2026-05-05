"use client";

// Static records page — values are pulled from public sources (NBA.com,
// basketball-reference, the May 2026 Yahoo records summary). They're not in
// our SQLite DB because most of them include awards, win-shares, and totals
// that need play-by-play + voting data we don't ingest. Update by hand each
// season; the date stamp at the bottom shows when these were last verified.

const LAST_UPDATED = "2026-05";

type Record = {
  value: string;
  label: string;
  detail?: string;
  // `crown: true` flags it as an all-time #1, painted in gold.
  crown?: boolean;
};

type Section = {
  title: string;
  blurb?: string;
  records: Record[];
};

const SECTIONS: Section[] = [
  {
    title: "Records held — all time #1",
    blurb: "The all-time leaderboard. Nobody else is on top of these.",
    records: [
      { value: "43,229", label: "career points", detail: "regular season + playoffs", crown: true },
      { value: "1,612", label: "career games", detail: "passed Robert Parish, Mar 2026", crown: true },
      { value: "8,289", label: "playoff points", detail: "2,300+ ahead of #2", crown: true },
      { value: "1,297", label: "consecutive double-digit games", crown: true },
      { value: "699", label: "30-point games", detail: "576 reg · 123 playoff", crown: true },
      { value: "21", label: "All-NBA selections", detail: "+6 over Kareem, Duncan, Kobe", crown: true },
      { value: "13", label: "All-NBA First Teams", detail: "+2 over Kobe, Malone", crown: true },
      { value: "22", label: "All-Star selections", detail: "+3 over Kareem", crown: true },
      { value: "275.6", label: "regular-season win shares", crown: true },
      { value: "59.5", label: "playoff win shares", detail: "Jordan: 39.8", crown: true },
      { value: "184", label: "playoff games won", crown: true },
      { value: "5", label: "playoff buzzer-beaters", crown: true },
      { value: "1,845", label: "unique opponents faced", crown: true },
      { value: "2,098", label: "points after age 40", crown: true },
    ],
  },
  {
    title: "Career volume",
    records: [
      { value: "23", label: "NBA seasons" },
      { value: "60,676", label: "regular-season minutes" },
      { value: "12,062", label: "playoff minutes" },
      { value: "15,884", label: "regular-season FG made" },
      { value: "2,971", label: "playoff FG made" },
      { value: "1,867", label: "playoff free throws made" },
      { value: "493", label: "playoff steals" },
      { value: "5,620", label: "regular-season turnovers" },
      { value: "158.8", label: "regular-season VORP" },
      { value: "36.6", label: "playoff VORP" },
    ],
  },
  {
    title: "Awards & recognition",
    records: [
      { value: "4", label: "championships", detail: "MIA '12, '13 · CLE '16 · LAL '20" },
      { value: "4", label: "Finals MVPs" },
      { value: "4", label: "regular-season MVPs", detail: "'09, '10, '12, '13" },
      { value: "69", label: "Player of the Week awards" },
      { value: "41", label: "Player of the Month awards" },
      { value: "449", label: "All-Star game points", detail: "11 All-Star losses" },
    ],
  },
  {
    title: "Off court",
    records: [
      { value: "$583,949,426", label: "career on-court earnings" },
    ],
  },
];

export function RecordsPage() {
  return (
    <div className="relative h-full w-full overflow-y-auto bg-black text-white">
      <div className="mx-auto max-w-[920px] px-8 pt-16 pb-32">
        {/* Header */}
        <div className="mb-12">
          <div className="font-mono text-2xl font-light tracking-[0.15em] text-white/95">LeBron James</div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.4em] text-white/40">Records · 2003-04 → 2025-26</div>
          <p className="mt-6 max-w-[640px] text-sm leading-relaxed text-white/65">
            The numbers that don&apos;t fit on a chart. Some are records he holds outright; some are just
            staggering totals nobody else is close to. Sources: NBA.com, basketball-reference, public reporting.
          </p>
        </div>

        {SECTIONS.map((section, i) => (
          <section key={section.title} className={i === 0 ? "" : "mt-14"}>
            <h2 className="text-[10px] uppercase tracking-[0.4em] text-white/55">{section.title}</h2>
            {section.blurb && (
              <p className="mt-2 max-w-[560px] text-xs text-white/45">{section.blurb}</p>
            )}
            <div className="mt-5 grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
              {section.records.map((r) => (
                <RecordRow key={`${section.title}-${r.label}`} record={r} />
              ))}
            </div>
          </section>
        ))}

        <div className="mt-20 border-t border-white/10 pt-6 text-[10px] uppercase tracking-[0.3em] text-white/35">
          Last verified · {LAST_UPDATED}
        </div>
      </div>
    </div>
  );
}

function RecordRow({ record }: { record: Record }) {
  const valueClass = record.crown
    ? "font-mono text-3xl font-light leading-none text-[#FDB927]"
    : "font-mono text-3xl font-light leading-none text-white/95";
  return (
    <div className="flex items-baseline gap-4 border-b border-white/[0.06] pb-4">
      <div className="min-w-[140px] flex-shrink-0">
        <div className={valueClass}>{record.value}</div>
      </div>
      <div className="flex-1">
        <div className="text-xs uppercase tracking-[0.2em] text-white/75">{record.label}</div>
        {record.detail && <div className="mt-1 text-[11px] text-white/40">{record.detail}</div>}
      </div>
    </div>
  );
}
