import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

// The Playwright smoke suite (scripts/e2e-server.mjs) builds and serves the app from its own folder, so
// `npm run test:e2e` never touches the .next folder of `npm run dev` and `npm run build`. Its tsconfig extends the
// main one, which stops Next from adding the folder's type paths to tsconfig.json. Types are checked by the
// gate's own build and tsc steps, so this build skips them.
const e2eBuild = process.env.TAOMIQ_E2E_BUILD === "1";

const nextConfig: NextConfig = {
  ...(e2eBuild
    ? { distDir: ".next-e2e", typescript: { tsconfigPath: "tsconfig.e2e.json", ignoreBuildErrors: true } }
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
