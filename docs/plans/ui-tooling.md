# Plan · UI tooling: Playwright smoke tests and shadcn/ui in the admin

## Goal

Adopt two outside tools, narrowly, and nothing else:

1. **Playwright** (dev-only): a small smoke suite that proves the public site and the host routing still work before a push to `main` reaches production.
2. **shadcn/ui** (admin only): accessible primitives copied into the repo as source, starting with the three destructive confirmations that use the browser's `confirm()` today.

Decided against, and why:

| Tool | Decision |
|---|---|
| Motion | Not added. The site's motion is CSS-first ([motion-mobile-ux.md](motion-mobile-ux.md)); nothing needs springs or drag physics |
| Magic UI | Not added. Generic animated blocks, extra JavaScript on a mobile-first site, off-brand |
| UI UX Pro Max skill | Not added. `docs/01-brand-foundation.md` and the tokens in `globals.css` already hold the design decisions |

There is no user-facing flow change on the public site. In the admin, three confirmations become in-page dialogs.

## Architecture

### Playwright

- `@playwright/test` as a devDependency, Chromium only. Two projects: a phone viewport (the main audience) and desktop.
- Tests live in `e2e/`, config in `playwright.config.ts`. Reports and traces go to git-ignored folders.
- **The suite runs against demo mode and must never reach the real database.** With the Supabase variables empty the app already serves the demo catalogue, the order form answers "ordering opens soon" (`state.demo`), no Telegram alert is sent and the admin shows `/setup`. The suite relies on that:
  - Playwright's `webServer` builds and starts the app itself on its own port (not 5555) with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_STAFF_CHAT_ID` forced empty. `NEXT_PUBLIC_*` values are inlined at build time, so the build must run with them empty too.
  - `.env.local` usually holds real keys. Verify in `node_modules/next/dist/compiled/@next/env` (or the docs) that an empty value in the process environment is not overwritten by `.env.local`. If it is, find another way that needs no change to production behaviour, and say what you chose.
  - The test build must not overwrite the `.next` folder that `npm run dev` and `npm run build` use. Use a separate output folder (for example `distDir` read from an environment variable in `next.config.ts`, git-ignored). Check `tsconfig.json` includes still work.
  - A guard runs before the tests (global setup or first test): it loads the admin host and fails the whole run unless the `/setup` page ("База данных не подключена") is shown. If demo mode is not on, no other test runs.
  - As a second barrier every test context aborts browser requests to `*.supabase.co` and `api.telegram.org`.
- The admin host in tests is `admin.localhost:<port>`; Chromium resolves `*.localhost` to loopback.
- Script: `npm run test:e2e`. It becomes the fourth step of the gate, after lint.

Smoke tests (keep each short, assert on roles and visible text from the dictionaries in `src/i18n/`, not on CSS classes). Tests that cover every language loop over `locales` from `src/i18n/config.ts` and take lang attributes and switch labels from there, so a new locale is covered without editing the suite:

1. `/` (and a path without a locale) redirects by `Accept-Language` as `src/proxy.ts` does: Russian → `/ru`, Uzbek → `/uz`, Uzbek naming the Cyrillic script (`uz-Cyrl`) → `/uzc`, anything else → the default locale (`/uz`).
2. Home page renders in every locale (uz, uzc, ru) with the right `<html lang>` (`uz-Latn`, `uz-Cyrl`, `ru`): one `h1`, header and footer present, no console errors, no failed same-origin requests.
3. The locale switch keeps the current path through every locale and back (`/uz/menu` → `/uzc/menu` → `/ru/menu` → `/uz/menu`).
4. Menu: dishes are listed, choosing another day in the day picker changes the list.
5. A program page (first demo program) shows its variants and prices.
6. Calculator: filling the form produces a calorie result and a recommended program.
7. Order form: submitting empty shows field errors and keeps typed values; a valid submission shows the demo notice and does not navigate to the success page.
8. Unknown path under each locale renders the localized not-found page with status 404.
9. Host routing: `/admin` on the public host returns 404 (production build); the admin host sends `X-Robots-Tag: noindex, nofollow`.
10. `/robots.txt` and `/sitemap.xml` respond 200 on the public host.

### shadcn/ui (admin only)

- Initialise with the current shadcn CLI for Tailwind 4 and React 19; read its current docs first, the CLI and its defaults change often. Components go to `src/components/ui/`, the helper to `src/lib/utils.ts`.
- **The public site must not change by one pixel.** shadcn's `init` edits `globals.css`; after it runs:
  - Keep the brand `@theme` block and everything else already in the file as it is.
  - Map shadcn's semantic variables onto brand tokens instead of its neutral palette: background → ivory, foreground → graphite, primary → forest (text ivory), secondary/muted/accent → ivory-deep, muted-foreground → muted, destructive → danger, border/input → line, ring → gold, card/popover → white. Radius to match the admin's existing rounded corners. No dark theme block.
  - Remove the base-layer rules shadcn adds for `*` and `body` (border colour, outline, background, text). The file already sets those for the brand.
  - Do not add `tw-animate-css` if the dialog can enter and leave with the existing motion tokens (`--duration-*`, `--ease-out-calm`) and still honour the global reduced-motion block. If it is needed, say so in the report.
- Only `src/app/admin/**` imports from `src/components/ui/`. The public site keeps its hand-written components. Add an ESLint `no-restricted-imports` rule for `src/app/[locale]/**` and `src/components/*.tsx` (not `ui/`) so this stays true.
- Add only what is used now: `alert-dialog` and `button` (plus whatever they pull in). No table, select, toast or form wrappers until a screen needs them.
- One shared client component `src/app/admin/ConfirmDialog.tsx` (or similar) wraps `AlertDialog`: title, description, confirm label, destructive flag, and it submits the surrounding form or runs a callback on confirm. Replace the three `confirm()` calls:
  - `src/app/admin/(panel)/orders/OrderControls.tsx` — cancel order
  - `src/app/admin/(panel)/dishes/DishForm.tsx` — delete dish
  - `src/app/admin/(panel)/menu/DayEditor.tsx` — copy a menu over the current one
  Behaviour stays the same: nothing happens without confirmation, the same server action runs with the same form data, pending and error states still show. Russian copy stays as it is, split into title and description.
- Dialog buttons use the admin's existing `.btn` look (forest primary, outline cancel, danger for destructive), minimum 44 px touch height, focus returns to the trigger on close.

## Data model

No schema change, no migration.

## Design rules

- Admin stays Russian-only, mobile-friendly, brand tokens only.
- Dialog: centred, max width about 28 rem, 16 px side gutter on a phone, forest-tinted overlay, title in the serif face, focus trapped, Escape and overlay click cancel.
- States: confirm button disabled and labelled "Сохраняем…"/"Удаляем…" while the action is pending.

## Slices

1. **Playwright smoke suite.** Dependency, config, isolated demo-mode build, guard, the ten tests, `test:e2e` script, `.gitignore` entries. Add the fourth gate step to `CLAUDE.md` (§3 gate line), `.claude/agents/builder.md` and `.claude/agents/shipper.md`, and a short "Tests" section in `README.md`. The suite must pass locally twice in a row.
2. **shadcn/ui foundation in the admin.** Init, token mapping, lint rule, `ConfirmDialog`, replace the three `confirm()` calls. Before and after the CSS change, capture full-page screenshots of `/uz`, `/uz/menu`, `/uz/order` and `/ru/calculator` at phone and desktop width with Playwright (demo build) and confirm they are identical; report the result. The smoke suite must still pass.

## Risks and open questions

- **Admin dialogs cannot be exercised by the smoke suite**: the admin needs a real staff sign-in, and the suite runs in demo mode. Slice 2 is covered by the gate, the reviewer and a manual check by the owner after it ships.
- **shadcn leaking into the public CSS** is the main risk of slice 2; the screenshot comparison and the lint rule are the controls.
- The gate gets slower by the time of one extra build plus the tests (expected one to two minutes).
- First run downloads the Chromium build Playwright needs (`npx playwright install chromium`).
