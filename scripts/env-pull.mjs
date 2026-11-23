// Keeps .env.local in step with the Development variables stored in Vercel.
// Runs before `npm run dev` (predev) and on demand with `npm run env:pull`.
// It never breaks local work: if the Vercel CLI is missing, the project is not linked,
// the machine is offline, or the pulled file lacks a required key, .env.local is left as it is.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";

const TARGET = ".env.local";
const TEMP = ".env.local.pulled";
const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
const strict = process.argv.includes("--strict"); // `npm run env:pull` reports failures; predev stays quiet

function stop(message) {
  rmSync(TEMP, { force: true });
  console.log(`env: ${message}; keeping the current ${TARGET}`);
  process.exit(strict ? 1 : 0);
}

if (!existsSync(".vercel/project.json")) stop("project is not linked to Vercel (run `vercel link`)");

const pull = spawnSync("vercel", ["env", "pull", TEMP, "--environment=development", "--yes"], {
  stdio: ["ignore", "ignore", "pipe"],
  encoding: "utf8",
  timeout: 30_000,
});
if (pull.error?.code === "ENOENT") stop("Vercel CLI is not installed (npm i -g vercel)");
if (pull.status !== 0 || !existsSync(TEMP)) stop("could not pull from Vercel (offline or not logged in)");

const pulled = readFileSync(TEMP, "utf8");
const missing = REQUIRED.filter((key) => !new RegExp(`^${key}=["']?[^"'\\s]`, "m").test(pulled));
if (missing.length) stop(`Vercel Development is missing ${missing.join(", ")}`);

renameSync(TEMP, TARGET);
console.log(`env: ${TARGET} updated from Vercel (Development)`);
