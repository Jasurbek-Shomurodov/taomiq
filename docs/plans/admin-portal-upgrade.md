# Plan · Admin portal upgrade (the zarkebab workspace pattern, in TAOMIQ's brand)

## Goal

`admin.taomiq.uz` today is a top bar with five text links and plain pages. Rebuild it on the pattern of
`admin.zarkebab.uz` (`~/Desktop/zar-kebab-pos`: `src/components/AppShell.jsx`, `UnifiedSidebar.jsx`,
`WorkspaceTopBar.jsx`, `src/styles/workspace.css`, `DESIGN.md`, `src/pages/AdminDashboard.jsx`, `AdminMenu.jsx`) —
read those files for reference before building; copy the *structure and behaviour*, not the colours or the code
(that project is Vite + React Router + Tailwind 3; this one is Next 16 App Router + Tailwind 4, server components).

What "similarly" means here:

1. A pinned app frame: grouped icon sidebar on the left, a frosted top bar, only `<main>` scrolls.
2. One small admin kit (tokens + classes + a few components) used by every screen.
3. A real dashboard: KPI tiles with day-over-day change, charts, breakdowns.
4. List screens with a toolbar (search, filter, cards/list toggle); editors as full pages with back + Save in the top bar.
5. Honest states: content-shaped skeletons, inline error notices, `—` instead of a fake zero.
6. Dark theme with no flash.

No change to the public site, to the database schema, to roles or to what each role may do.

## User flow

- Staff sign in as before. They land on the dashboard inside the new frame.
- Sidebar (256 px, from `lg` up; collapsible, remembered per device). Groups:
  - *(no heading)* Overview
  - **Sales** — Orders (owner only; gold count pill = orders in status `new`)
  - **Kitchen** — 30-day menu, Dishes
  - **Business** — Programs and prices (owner only)
  - Foot: language segmented switch (Oʻz | Ўз | Рус), then an account row (initial avatar, name, email/role) and a sign-out icon button.
  - Head: TAOMIQ lockup + a role pill (Owner / Admin) + a collapse button.
- Below `lg` the sidebar is a drawer from the left (backdrop, focus trap, Escape, closes on navigation).
- Top bar (60 px, sticky, translucent ivory + blur): drawer/expand button (phones, or desktop while collapsed), optional back arrow, page title (15 px semibold), optional page tabs, then page actions and the theme toggle on the right.

## Architecture

Everything stays under `src/app/admin/**` (the ESLint rule keeps admin components out of the public site).

### Shell

- `src/app/admin/(panel)/layout.tsx` (server): keeps `requireStaff()` and the `<Suspense>` streaming it has now, and renders `<AdminShell>`.
- `src/app/admin/shell/AdminShell.tsx` (client): frame, collapse state (`localStorage` key `taomiq-admin-sidebar`), drawer state. Collapsed rail is `inert` and width-animated (300 ms, transform/width only, honours the global reduced-motion block).
- `src/app/admin/shell/Sidebar.tsx`, `TopBar.tsx`, `MobileDrawer.tsx`, `ThemeToggle.tsx` (slice 5).
- `src/app/admin/shell/nav.ts`: one `NAV` array `{ key, href, icon, group, ownerOnly }` and `NAV_GROUPS`; the server layout filters it by role and passes labels from the admin dictionary plus the badge count. Active item from `usePathname()` by prefix (`/` exact). `aria-current="page"` on the active row.
- **Page title and header content.** The layout cannot know the page, so:
  - Title: `TopBar` derives it from the pathname through the nav map (labels passed as props). Detail/editor pages override it.
  - `src/app/admin/shell/TopBarSlot.tsx` (client): `<TopBarTitle>`, `<TopBarBack href label>`, `<TopBarTabs>` and `<TopBarActions>` render their children into fixed slots of the top bar through `createPortal` (target elements by id, looked up after mount). Pages use these instead of an in-page `<h1>` + button row. On phones tabs drop to a second 44 px strip under the bar.
  - The document `<title>` keeps coming from each page's `generateMetadata`.
- The new-orders badge: the layout reads `newOrderCount()` for owners inside its own `<Suspense>` (`shell/NewOrdersBadge.tsx`) and seeds a client pill with it (`shell/NewOrdersPill.tsx`). The layout is not re-rendered on a client navigation, so the pill reads the count again whenever `usePathname()` changes, through the server action `readNewOrderCount()` (`lib/admin/actions.ts`): owner-checked like `requireOwner()` but without redirecting, returning `null` for anyone else, no session or a failed read. One read per path is shared by the rail and drawer copies. A refreshed layout (after an order action) re-seeds it. No pill at `0` or when the count is unknown (never a made-up `0`); the visible number is `aria-hidden` with a visually hidden label ("Новых заказов: 5"). No polling, no realtime in this plan.
- `LanguageSwitch` becomes the segmented control in the sidebar foot (same `setAdminLocale` action).
- Login and setup pages (`AuthShell`) are not touched, except that they must render correctly in the dark theme (slice 5).

### Admin kit

- Tokens: a block in `globals.css` scoped to `.admin` (class on the admin `<body>`), so the public site cannot change:
  `--adm-page`, `--adm-surface`, `--adm-surface-muted`, `--adm-hover`, `--adm-border`, `--adm-text`, `--adm-text-muted`,
  `--adm-accent` (forest), `--adm-accent-ink`, `--adm-accent-tint`, `--adm-highlight` (gold),
  `--adm-positive`, `--adm-negative`, `--adm-caution`, `--adm-info`, radii (button 8, control 10, card 12, dialog 16), one shadow.
  Light values come from the brand tokens (ivory page, white cards, `line` border, graphite text, `muted` grey, forest accent, gold highlight, `danger` negative). Expose them to Tailwind with `@theme inline` names (`bg-adm-surface`, `text-adm-muted`, …) so the dark theme is a variable swap.
- Classes in a new `src/app/admin/admin.css` imported by the admin layout (`@layer components`): `.adm-page` (page padding and 20 px gap), `.adm-panel` / `.adm-panel-flush`, `.adm-row` (divider row with hover), `.adm-table-head`, `.adm-input` (44 px), `.adm-btn` + `-sm`, `-icon`, `-primary`, `-outline`, `-ghost`, `-danger`, `.adm-segmented`, `.adm-tabs`, `.adm-badge` / `.adm-status` / `.adm-count` with `.adm-tone-positive|negative|caution|info|accent|neutral` (built with `color-mix` 10–12 % tints), `.adm-empty`, `.adm-notice`, `.adm-skeleton` (shimmer). Under `@media (pointer: coarse)` every control is at least 44 px tall.
- Components in `src/app/admin/kit/`: `Panel`, `StatTile`, `EmptyState`, `Notice` (with optional retry link), `Skeleton` + `PageSkeleton({ layout: "dashboard" | "table" | "cards" | "form" | "detail" })`, `SearchField` (client, debounced, writes `?q=` with `router.replace`), `Segmented`, `Badge`. The existing `StatusBadge` and dish badges move onto `.adm-status` tones; `ConfirmDialog` keeps working and takes the kit radii.
- Typography in the panel: Manrope only (body 15 px, caption 13, nothing under 12). The serif stays in the logo lockup and the login page. Sentence case, buttons are a verb + object, money through `formatSum` with `tabular-nums whitespace-nowrap`.
- Icons: add `lucide-react` (the only new dependency; admin only — extend the ESLint restricted-imports rule so the public site cannot import it).
- Loading: a `loading.tsx` per panel route using `PageSkeleton` built from the real panel boxes. Spinners only inside a pressed button.
- Rules taken from zarkebab's `DESIGN.md`: colour carries meaning and the status word is always shown; no cards inside cards (use divider rows); one primary button per surface; a failed load prints `—` plus a notice, never zero; confirm buttons name the action.

### Dashboard (`(panel)/page.tsx`)

- New `src/lib/admin/stats.ts` (`server-only`, pure functions + one loader). The loader reads the last 60 days of orders with
  only `created_at, status, total, program_name, kcal, days, source` (no name, phone or address), paging in chunks of 1000 up to 5000 rows; if the cap is hit the dashboard says the figures are partial. Day buckets are in `Asia/Tashkent`. Unit-free pure helpers so they can be checked by a small script.
- Owner sees (all owner-only data comes through the owner's session; RLS already returns nothing to admins):
  1. KPI row (4 `StatTile`s, each: caption, figure, icon chip, "Yesterday: …" line, ±% tone badge; `—` when unknown):
     new orders waiting (links to `/orders?status=new`, caution tone when > 0) · orders today · order value today (sum of `total`, cancelled excluded) · active subscriptions (status `active`).
  2. "Orders, last 30 days": hand-built bar chart (divs/SVG, no chart library), today's bar solid, the rest at 35 %, a tooltip/`title` and a visually hidden table for screen readers; a segmented switch between count and value (`?chart=`).
  3. "By status": a horizontal funnel of the six statuses with counts for the period.
  4. "By program": progress rows per program/kcal — orders, value, share.
  5. "Where orders come from": `source.utm_source` / `ref` grouped, "direct" when empty.
- Everyone sees:
  6. "30-day menu readiness" — the existing per-variant progress list, in a flush panel with divider rows.
  7. "Dishes" — total, active, without a verified card, without a photo, as tiles linking to the filtered dishes list.
- Each block fails on its own: an error in orders stats shows a `Notice` in that panel and the catalogue blocks still render.

### Dishes

- Toolbar panel: search (name in any of the three languages, client-side over the loaded list — the catalogue is small), status filter (all / visible / hidden / no card / no photo, in `?status=`), cards/list segmented toggle (remembered in a cookie so the server renders the right view), "Add dish" primary button in the top bar actions.
- Cards view: photo cards in an auto-fit grid (photo 4:3, name, second-language name, kcal and B/J/U per 100 g, status badges). List view: the current table on kit classes.
- A count line ("24 dishes") and an empty state with "Clear filters".
- Editor (`/dishes/[id]`, `/dishes/new`): full page with `TopBarBack` to the list, title = dish name or "New dish", Save in the top bar (submits the form by `form=` id), the form in panels (Names · Nutrition · Photo · Visibility). Delete stays behind `ConfirmDialog`. Server actions are unchanged.

### Orders (owner)

- Status tabs move into the top bar (`TopBarTabs`, with counts). Toolbar: search by order number, phone digits or customer name (`?q=`), server-side. The term is reduced to letters, digits, spaces and `+` before it goes into a PostgREST `or()` filter (`customer_name.ilike`, `phone.ilike`, and `number.eq` when it is all digits) — never interpolate raw input. Pagination keeps `q` and `status`.
- Table on kit classes; rows collapse to stacked cards on phones (no horizontal scroll under 640 px).
- Detail page: `TopBarBack`, title "Order 1042" + status badge, the cards on `Panel`, status controls and note in a sticky right column on desktop. Actions unchanged.

### Menu and Programs

- Menu: variant chips as a scrolling pill strip in a panel, the day grid and `DayEditor` on kit classes, the kcal total line as a tone badge (positive within ±5 %, caution otherwise), Save in the top bar actions. Logic unchanged.
- Programs: each program a flush panel with a heading; durations as rows; Save per panel with the kit's busy/saved button states. Logic unchanged.

### Dark theme

- `ThemeToggle` in the top bar; choice in a cookie `admin_theme` (`light` | `dark` | absent = system). The admin root layout reads the cookie and sets `data-theme` on `<html>`; with no cookie a tiny inline script in `<head>` applies `prefers-color-scheme` before paint (no flash). `color-scheme` and `meta theme-color` follow.
- `.admin[data-theme="dark"]` (and the system-preference equivalent) redefines the `--adm-*` variables: deep forest-black page (`#0f1513`-ish), raised surfaces, ivory text, gold highlight, forest accent lightened to stay ≥ 4.5:1. Brand utilities still used inside the panel (`text-forest`, `bg-white`, `bg-ivory`, `border-line`) must be replaced by `adm-*` names in slices 1–4 so this slice is only variables.
- The login and setup pages follow the same attribute.

## Data model

No migration. No new tables, columns, policies or functions. All new reads go through the signed-in staff session and existing RLS; the dashboard reads no personal data columns.

## Design rules

- Layout: frame is `fixed inset-0 flex`; content column max-width 72 rem inside `.adm-page`; self-wrapping grids (`auto-fit`, `flex-wrap`) before breakpoints.
- States: every list has loading (skeleton), empty (icon, one line, action), error (notice + retry link) and filtered-empty ("Clear filters").
- Locales: every new string in `src/i18n/admin/ru.ts`, `uz.ts`, `uzc.ts` (typed parity). Numbers and dates through the existing formatters.
- Accessibility: 44 px touch targets, visible focus (gold ring), `aria-current`, focus trap in the drawer, charts have a text alternative, colour never the only signal.
- Motion: existing duration/ease tokens; only opacity/transform (and the rail width) animate.

## Slices

1. **Shell and kit.** Tokens, `admin.css`, kit components, `lucide-react`, sidebar / top bar / drawer / top-bar slots, new-orders badge, language switch in the sidebar, `loading.tsx` skeletons. Every existing page moves into the frame: in-page `<h1>` rows become top-bar titles/actions and brand colour utilities become `adm-*` names, with no change to behaviour.
2. **Dashboard.** `stats.ts`, KPI tiles with change, 30-day chart, status funnel, by-program, sources, menu readiness, dish tiles.
3. **Dishes and orders.** Dishes toolbar, cards/list, full-page editor with Save in the top bar; orders tabs in the top bar, search, stacked rows on phones, detail layout.
4. **Menu and programs.** Both screens on the kit, Save in the top bar, tone badges.
5. **Dark theme.** Toggle, cookie, no-flash script, dark variables, login/setup pages.

Each slice leaves `main` working and passes the gate. Slices 1, 2 and 3 get a reviewer (session/auth layout, order data).

## Risks and notes

- The Playwright suite runs in demo mode, where the admin only shows `/setup`; it cannot cover the panel. Each slice is checked by hand at `http://admin.localhost:5555` with a signed-in session (phone and desktop widths, three locales).
- `createPortal` slots: the target must exist before a page's slot mounts; the top bar renders outside the page `<Suspense>`, so it does. Slots render nothing on the server (no layout shift: the bar has a fixed height).
- Dashboard aggregation is done in the server component from at most 5000 rows. When volume outgrows that, move it to a SQL function (a later, separate migration).
- No realtime badge, no audit log, no staff management screen, no Excel export in this plan — zarkebab has them; they are separate features to plan if wanted.
