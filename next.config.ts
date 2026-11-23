import type { NextConfig } from "next";

const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
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
