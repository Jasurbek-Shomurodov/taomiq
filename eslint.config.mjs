import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // shadcn/ui primitives (src/components/ui) are for the admin only. The public site keeps its hand-written
  // components, so its bundle and look never depend on them.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/*.{ts,tsx}"],
    ignores: ["src/app/admin/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/components/ui", "@/components/ui/*", "**/components/ui", "**/components/ui/*", "./ui", "./ui/*"],
              message: "src/components/ui is for the admin only (src/app/admin). The public site uses its own components.",
            },
            {
              group: ["@/app/admin", "@/app/admin/**"],
              message: "Admin components (they use src/components/ui) stay in the admin.",
            },
            {
              group: ["@base-ui/*"],
              message: "Base UI is for the admin's src/components/ui only.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Playwright suite's own build and reports (npm run test:e2e).
    ".next-e2e/**",
    "playwright-report/**",
    "test-results/**",
    // Agent worktrees are separate checkouts with their own build output.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
