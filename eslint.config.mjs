import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// exceljs builds the back office's Excel files and is imported only by the export route's folder
// (src/app/admin/(panel)/reports/export), on the server. Nothing else may import it: not the public site, not a page,
// not a client component.
const EXCELJS_PATTERN = {
  group: ["exceljs", "exceljs/*"],
  message: "exceljs is for the admin's Excel export only (src/app/admin/(panel)/reports/export).",
};

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
              group: ["@/app/admin", "@/app/admin/**", "**/admin/kit", "**/admin/kit/*", "**/admin/shell", "**/admin/shell/*"],
              message: "Admin components (the admin kit and shell, src/components/ui) stay in the admin.",
            },
            {
              group: ["@base-ui/*"],
              message: "Base UI is for the admin's src/components/ui only.",
            },
            {
              group: ["lucide-react", "lucide-react/*"],
              message: "lucide-react icons are for the admin panel only (src/app/admin). The public site draws its own.",
            },
            EXCELJS_PATTERN,
          ],
        },
      ],
    },
  },
  // The rest of the source (the admin, lib, the shadcn primitives, scripts): exceljs only. The files of the block above
  // are left out here, because a second no-restricted-imports entry for the same file would replace the first.
  {
    files: ["src/**/*.{ts,tsx,js,mjs}", "scripts/**/*.{js,mjs,ts}", "e2e/**/*.ts"],
    ignores: ["src/app/*/**", "src/app/*.{ts,tsx}", "src/components/*.{ts,tsx}", "src/app/admin/*/reports/export/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [EXCELJS_PATTERN] }] },
  },
  {
    files: ["src/app/admin/**/*.{ts,tsx}"],
    ignores: ["src/app/admin/*/reports/export/**"],
    rules: { "no-restricted-imports": ["error", { patterns: [EXCELJS_PATTERN] }] },
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
    ".next-e2e-account/**",
    "playwright-report/**",
    "test-results/**",
    // Agent worktrees are separate checkouts with their own build output.
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
