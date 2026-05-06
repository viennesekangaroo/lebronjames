/**
 * Pre-renders every API route's response to a static JSON file under
 * `public/api/*.json`, so the deployed site can serve the data without a
 * database at runtime.
 *
 *   Run automatically by `npm run build` via the prebuild step.
 *
 * Each route handler is imported directly (Next.js route files export a `GET`
 * function), invoked, and its body is written to disk. This means we read
 * straight from `data/nba.db` here on the build machine — Vercel's deployed
 * functions never touch SQLite.
 */
import fs from "node:fs";
import path from "node:path";

const ROUTES: { name: string; modulePath: string }[] = [
  { name: "lebron-teammates", modulePath: "../src/app/api/lebron-teammates/route" },
  { name: "lebron-opponents", modulePath: "../src/app/api/lebron-opponents/route" },
  { name: "lebron-games",     modulePath: "../src/app/api/lebron-games/route" },
  { name: "lebron-points",    modulePath: "../src/app/api/lebron-points/route" },
  { name: "lebron-shots",     modulePath: "../src/app/api/lebron-shots/route" },
  { name: "lebron-records",   modulePath: "../src/app/api/lebron-records/route" },
  { name: "lebron-playoffs",  modulePath: "../src/app/api/lebron-playoffs/route" },
];

const OUT_DIR = path.join(process.cwd(), "public", "api");
const DB_PATH = path.join(process.cwd(), "data", "nba.db");

async function main() {
  // On Vercel / any environment without the source SQLite DB, skip and rely
  // on the JSON files committed under public/api/. This script's job is only
  // to refresh those locally before pushing.
  if (!fs.existsSync(DB_PATH)) {
    console.log(`prebuild: ${DB_PATH} not present — skipping (using committed JSON).`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const route of ROUTES) {
    process.stdout.write(`  ${route.name}... `);
    const mod = (await import(route.modulePath)) as { GET: () => Promise<Response> };
    if (typeof mod.GET !== "function") {
      throw new Error(`${route.name}: no GET export`);
    }
    const res = await mod.GET();
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${route.name}: handler returned ${res.status} ${body.slice(0, 200)}`);
    }
    const text = await res.text();
    const outPath = path.join(OUT_DIR, `${route.name}.json`);
    fs.writeFileSync(outPath, text);
    const sizeKb = (text.length / 1024).toFixed(1);
    process.stdout.write(`${sizeKb} KB\n`);
  }

  console.log(`\nWrote ${ROUTES.length} JSON files to public/api/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
