import type { NextConfig } from "next";
import {
  ANALYTICS_PATH,
  POSTHOG_API_HOST,
  POSTHOG_ASSETS_HOST,
  isAnalyticsEnabled,
} from "./src/lib/analytics/config";
import { locales } from "./src/i18n/config";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

// The Playwright smoke suite (scripts/e2e-server.mjs) builds and serves the app from its own folder, so
// `npm run test:e2e` never touches the .next folder of `npm run dev` and `npm run build`. Its tsconfig extends the
// main one, which stops Next from adding the folder's type paths to tsconfig.json. Types are checked by the
// gate's own build and tsc steps, so this build skips them. TAOMIQ_E2E_BUILD=account is the signed-in account suite's
// build (scripts/e2e-server.mjs --account), in a folder of its own.
const e2eBuild = process.env.TAOMIQ_E2E_BUILD;
const e2eDistDir = e2eBuild === "1" ? ".next-e2e" : e2eBuild === "account" ? ".next-e2e-account" : undefined;

const nextConfig: NextConfig = {
  ...(e2eDistDir
    ? { distDir: e2eDistDir, typescript: { tsconfigPath: "tsconfig.e2e.json", ignoreBuildErrors: true } }
    : {}),
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    // Dish photos live in Supabase Storage.
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  // The order alert image (src/lib/order/alertImage.ts) draws with these fonts and this monogram. They are
  // read through Fontconfig and the file system, not imported, so file tracing cannot see them; the order
  // action runs in this route.
  // sharp itself is on Next's built-in serverExternalPackages list and is traced as a dependency.
  outputFileTracingIncludes: {
    "/\\[locale\\]/order": ["./src/assets/fonts/*.ttf", "./src/assets/brand/monogram-alert.png"],
  },
  // Analytics (src/lib/analytics, docs/plans/analytics.md): the browser sends to our own /k7r2 path and this
  // forwards it to PostHog EU, so the SDK is first-party. Only with the key set, and only on the public host (PostHog
  // never loads on the admin host; there the proxy sends /k7r2 under /admin, which has no such page). The proxy
  // matcher (src/proxy.ts) skips the path, so it is never locale-redirected.
  //
  // IndexNow (docs/plans/findability-and-growth.md, slice 2): the key file taomiq.uz/{key}.txt is served by
  // src/app/api/indexnow/[key]/route.ts, which answers 404 unless the name is the INDEXNOW_KEY. The name follows
  // IndexNow's key rule (8–128 of a–z, A–Z, 0–9, "-"), so /llms.txt and /robots.txt never match. Public host only.
  async rewrites() {
    const publicHost = { missing: [{ type: "host" as const, value: "admin\\..*" }] };
    const indexNow = [
      { source: "/:key([a-zA-Z0-9-]{8,128})\\.txt", destination: "/api/indexnow/:key", ...publicHost },
    ];
    if (!isAnalyticsEnabled) return indexNow;
    return [
      ...indexNow,
      { source: `${ANALYTICS_PATH}/static/:path*`, destination: `${POSTHOG_ASSETS_HOST}/static/:path*`, ...publicHost },
      { source: `${ANALYTICS_PATH}/array/:path*`, destination: `${POSTHOG_ASSETS_HOST}/array/:path*`, ...publicHost },
      { source: `${ANALYTICS_PATH}/:path*`, destination: `${POSTHOG_API_HOST}/:path*`, ...publicHost },
    ];
  },
  // The protein, BMI, water and body goal tools were merged into the one calculator (docs/plans/site-ux-navigation-pass.md,
  // slice 4): their old addresses, in every locale, move to it for good (308), so links and search results keep working.
  async redirects() {
    return [
      {
        source: `/:locale(${locales.join("|")})/calculator/:tool(protein|bmi|water|body)`,
        destination: "/:locale/calculator",
        permanent: true,
      },
    ];
  },
  // PostHog's endpoints end in a slash (/k7r2/e/); Next.js would redirect them to the slash-less path. With this off,
  // src/proxy.ts does that redirect itself for every page (308, as Next.js did), so pages keep one URL.
  skipTrailingSlashRedirect: true,
  // Let the admin subdomain load dev assets: http://admin.localhost:3000
  allowedDevOrigins: ["admin.localhost"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
