// Builds and starts the app for the Playwright smoke suite (playwright.config.ts → webServer).
//
// Demo mode: the Supabase, Telegram, Turnstile and PostHog variables are forced to empty strings below. Next's env loader
// (@next/env, processEnv) fills a variable from .env.local only when it is undefined in the process
// environment, and an empty string is not undefined, so the empty value wins over the real keys in .env.local,
// both for `next build` (NEXT_PUBLIC_* values are inlined then) and for `next start`. The app then serves the demo
// catalogue, the order form answers "ordering opens soon" and the admin shows /setup. The suite's first project
// (e2e/demo-mode.setup.ts) checks that from the outside and stops the run if it is not so.
//
// Isolation: TAOMIQ_E2E_BUILD=1 makes next.config.ts build into .next-e2e with tsconfig.e2e.json, so the .next
// folder of `npm run dev` and `npm run build` is left alone. `next build` still points next-env.d.ts at .next-e2e;
// the file is put back afterwards so `npx tsc --noEmit` keeps reading the main build's route types.
//
// --account: the signed-in account suite instead (playwright.config.ts → the `account` project). Same demo env, except
// that Supabase points at a local mock (scripts/e2e-mock-supabase.mjs, started here, in this process) and email sign-in
// is on, so /account renders a made-up customer. Never the real database: the URL is always localhost. Builds into
// .next-e2e-account (TAOMIQ_E2E_BUILD=account) and serves on E2E_ACCOUNT_PORT (5598), the mock on E2E_MOCK_PORT (5595).
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { startMockSupabase } from "./e2e-mock-supabase.mjs";

const account = process.argv.includes("--account");
const port = account ? (process.env.E2E_ACCOUNT_PORT ?? "5598") : (process.env.E2E_PORT ?? "5599");

const DEMO_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SECRET_KEY: "",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_STAFF_CHAT_ID: "",
  TELEGRAM_OWNER_CHAT_ID: "",
  // The daily Telegram run answers 503 without its secret (e2e/smoke.spec.ts checks that).
  CRON_SECRET: "",
  // Customer sign-in off: no login link, /login and /account are 404 (also implied by the empty Supabase keys).
  NEXT_PUBLIC_AUTH_METHODS: "",
  // Back-office Google sign-in off: no Google button on the admin login (also implied by the empty Supabase keys).
  ADMIN_GOOGLE_LOGIN: "",
  // No bot check: the Turnstile widget is not rendered and the server check passes.
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
  TURNSTILE_SECRET_KEY: "",
  // No analytics: PostHog is not loaded and its first-party path is not routed.
  NEXT_PUBLIC_POSTHOG_KEY: "",
};

const env = {
  ...process.env,
  ...DEMO_ENV,
  NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
  TAOMIQ_E2E_BUILD: account ? "account" : "1",
  NEXT_TELEMETRY_DISABLED: "1",
};

if (account) {
  const mockPort = Number(process.env.E2E_MOCK_PORT ?? 5595);
  // Before the build: the build reads the catalogue (generateStaticParams) from it.
  await startMockSupabase(mockPort);
  Object.assign(env, {
    NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${mockPort}`,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-mock-publishable-key",
    NEXT_PUBLIC_AUTH_METHODS: "email",
  });
}

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [nextBin, ...args], { env, stdio: "inherit" });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

const TYPES_FILE = "next-env.d.ts";
const typesBefore = existsSync(TYPES_FILE) ? readFileSync(TYPES_FILE, "utf8") : null;

let built;
try {
  built = await run(["build"]);
} finally {
  if (typesBefore === null) rmSync(TYPES_FILE, { force: true });
  else if (!existsSync(TYPES_FILE) || readFileSync(TYPES_FILE, "utf8") !== typesBefore) {
    writeFileSync(TYPES_FILE, typesBefore);
  }
}
if (built !== 0) {
  console.error(`e2e: next build failed (exit ${built})`);
  process.exit(built);
}

process.exit(await run(["start", "--port", port]));
