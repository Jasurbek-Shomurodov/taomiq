# Plan · Second port from zarkebab: everything that fits a meal-plan business

Status (25 Nov 2026): slices 1–8, 13 and 10a are built and in production (commits c14d35e, 7bcd2a4, c633abf,
254b16b, 9a60931, d848c4d, d0b9717, 6661ffc, e47c34d, e84bd68; migrations 0017–0025). Not built: 9 (Telegram round
two: needs a second chat id and a webhook secret from the owner), 10 viewer role (changes the `staff.role` check
constraint: needs the owner's yes), 11 (attendance: depends on 9), 12 (public pages: need real text, address,
hours), 14 (assistant: paid AI usage), 15 (backup: needs a storage bucket and keys). Planned 25 Nov 2026. Source: a full read of `~/Desktop/zar-kebab-pos` (routes in `src/App.jsx`,
`src/lib/permissions.js`, `docs/agent/*.md`, migrations 001–285) against the taomiq code on the same day.

Earlier ports took the workspace shell (`admin-portal-upgrade.md`) and the money side
(`finance-investor-payroll.md`). This plan lists **every** zarkebab feature, says where taomiq stands, and slices
the rest. Nothing is copied file for file: zarkebab is Vite + React Router + client Supabase; taomiq is Next App
Router, server components, the `adm-*` kit, three locales (uz, uzc, ru), owner/manager/admin RLS.

## 1. Full zarkebab feature list and taomiq status

Legend: **Have** = already in taomiq · **Slice N** = planned below · **No** = does not fit (reason given).

### Pages (zarkebab route → taomiq)

| zarkebab page | What it does | taomiq |
|---|---|---|
| `/menu`, `/menu/item/:id`, `/search` | Public menu, dish page, search | Have (`/menu`, dish sheet). Dish pages with their own URL: `findability-and-growth.md` |
| `/premium-menu` | Tourist prices, USD/EUR switch | No (one price list, local customers) |
| `/corporate-sets`, `/catering` | Corporate food landing page | Slice 12 (`/corporate`) |
| `/frozen-meals` | Frozen shop categories | No (no such product) |
| `/vacancies`, `/vacancies/:id` | Job list, apply by Telegram or phone | Slice 12 (`/vacancies`) |
| Visit block: open now, call, map chooser | Contact and directions | Slice 12 (`/contacts`) |
| `/telegram` Mini App | Read-only menu, loyalty balance | Later (needs the customer bot; see `findability-and-growth.md`) |
| `/login`, `/reset-password`, `/pending-approval` | Staff sign-in, approval wait | Have |
| `/checkin-screen`, `/checkin-qr` | Attendance kiosk with rotating QR | Slice 11 |
| `/waiter/*`, `/cashier/*`, `/kitchen-check`, `/receipt` | Tables, bills, 80 mm receipts | No (no dine-in). The kitchen and delivery sheets are taomiq's equivalent |
| `/admin` | Dashboard | Have; more tiles in slice 5 |
| `/admin/menu` (+ product, category editors) | Menu manager | Have (`/dishes`, `/menu`, `/programs`); archive and extras in slice 7 |
| `/admin/tech-cards` | Recipes and cost per portion | Slice 7 |
| `/admin/ingredients`, `/usage`, `/sheet` | Ingredient catalog, purchases vs usage, purchase grid | Slice 6 (catalog, grid), slice 7 (usage) |
| `/admin/bazaar` | Market purchase receipts, history, analytics | Slice 6 |
| `/admin/inventory` | Equipment register | Slice 13 |
| `/admin/tables` | Tables and zones | No |
| `/admin/users` | Team, roles, per-user feature access | Have (roles, requests); viewer role in slice 10 |
| `/admin/loyalty` | Cashback cards with tiers | Slice 4 gives the customer list; cashback is an open question (Q3) |
| `/admin/accounting`, `/history`, `/salaries`, `/employees`, `/employees/:id/history` | Ledger, payroll | Have; history search, edit audit, salary calendar in slices 3 and 8 |
| `/admin/financial-analysis`, `/estimate`, `/owner-profit` | Analysis, estimate, month close | Have; missing indicators in slice 8 |
| `/admin/reports` | Sales reports, order history, Excel | Slice 5 |
| `/admin/assistant` | Read-only AI chat over the figures | Slice 14 |
| `/admin/audit` | Money and order change log | Slice 3 |
| `/admin/settings` | Business settings, system health | Slice 1 |

### Features by area

| Area | zarkebab feature | taomiq |
|---|---|---|
| Orders | Staff create orders | Slice 2 (manual order) |
| | Edit a bill atomically, locked after payment | Slice 2 (edit order fields before it starts) |
| | Actor tracking: who opened, who completed | Slice 2 |
| | Delete or cancel needs a typed reason | Slice 2 |
| | Payment method per order, split payments, change method later (audited) | Slice 2 (one method per order, change audited). Split: No until online payments |
| | Order history with receipt | Slice 5 |
| | Kitchen rounds, tables, reservations, service charge, tourist rate, Game Club, quick items | No |
| Money | Ledger, investor support, categories, month, year, payback, month close | Have |
| | Backdate limit (today or 3 days back) | Slice 8 |
| | All-accounting history with search and day totals | Slice 8 |
| | Record audit (who added, who deleted) | Slice 3 |
| | Indicators: savings rate, daily burn, runway, all-time balance | Slice 8 |
| | Flow by payment method, bank fee rates per method | Slice 8 (needs slice 2) |
| | Records: best month, best 10 days; customers vs average check | Slice 8 |
| | Sankey money flow | Slice 8 (last; hand-built SVG) |
| | Employee meals cost | No (kitchen staff eat from production; revisit if tracked) |
| Payroll | Rates, payments, bonuses, fines, absences, advance | Have |
| | Job function, remote flag | Slice 9 |
| | Salary history calendar per employee | Slice 9 |
| | Telegram link per employee, payment notice with a "received" button | Slice 9 |
| | KPI % bonus from sales | No for now (Q5) |
| | Late fines from check-in | Slice 11 |
| | Pay an order from salary | No |
| Stock | Ingredient catalog with usual price, units, pieces per pack, archive | Slice 6 |
| | Bazaar receipts mirrored as one expense, price variance | Slice 6 |
| | Tech cards, portion cost, margin, cost-overrun list, PDF | Slice 7 |
| | Purchases vs theoretical usage | Slice 7 |
| | Piece stock deduction on payment | No (cooked to order) |
| | **New for taomiq:** shopping list for a day from the production sheet × tech cards | Slice 7 |
| Menu | Archive instead of delete, restore | Slice 7 |
| | Media gallery (several photos, video) | Later (`kitchen-video.md` covers video) |
| | Old price / deals | Later (promo codes are in `us-eu-features.md`) |
| | Drag-and-drop order, visibility schedules, cashier-only | No |
| Reports | Best selling, by category, by hour, payment methods, order types, staff performance | Slice 5 (by program, calorie level, duration, weekday and hour, source, payment method, renewals) |
| | Excel export | Slice 5 |
| Team | Roles, approval lifecycle | Have |
| | Viewer (read-only) role, per-user feature switches | Slice 10 (viewer / investor role only; per-user switches: Q4) |
| | Role change audit | Slice 3 |
| Telegram | Paid-order message with day totals | Have (new-order card); paid message in slice 9 |
| | Investor group: expenses, purchases, order changes, month close | Slice 9 |
| | Morning digest (yesterday's money, today's rations, ending plans) | Slice 9 |
| | Database-first queue, retry, delivery status | Slice 9 |
| | Employee messages | Slice 9 |
| Attendance | Kiosk QR, bot check-in, arrival status, lists | Slice 11 |
| Dashboard | Today's income, net profit, payment donut, busy hours, last updated | Slice 5 |
| | Realtime badges and refresh | Slice 10 |
| Settings | Business fields, instant save per control, system health | Slice 1 |
| Ops | Nightly encrypted backup to R2 with failure alert | Slice 15 (needs an R2 bucket and keys from the owner) |
| | Google review auto-replies, Google and Yandex menu sync | Blocked: needs live business listings (`findability-and-growth.md`) |
| | Migration receipts, health command, CI | Have (gate) / slice 1 (health panel) |
| UX | Shell, skeletons, error notices, dark theme, i18n | Have |
| | Save disabled until changed, `returnTo` after sign-in, connection notice | Folded into the slices that touch those screens |

## 2. Slices

Each slice ships alone and leaves `main` working. Order is by daily usefulness to the owner. Slices 1–8 need
nothing from outside the repo. A slice gets its own short build spec appended under "Build specs" before it is built.

1. **Settings screen** — `/settings`, owner only. Delivery windows, order cutoff hour, menu cycle start date,
   contact phone and Telegram handle, the three finance settings (moved from the close page, link kept), language
   and theme. Each control saves on its own and shows saved / failed. A "System" panel: migration count, env
   presence (names only), Telegram alert on/off.
2. **Order operations** — staff create an order by hand; edit address, window, comment, exclusions, start date
   while the order has not started; payment method chosen when marking paid (cash, card, transfer); cancel needs a
   reason; who did each status change; a timeline on the order page. Migration: `order_events`, new columns.
3. **Audit page** — `/audit`, owner only: order events, finance record add/delete, payroll events, team role
   changes, settings changes. Search, type filter, 100 per page. Migration: `audit_log` + triggers.
4. **Customers** — `/customers`, owner and manager: one row per phone (orders with and without an account), orders
   count, total paid, first and last order, active plan end date, source. Customer page with order history and a
   staff note. Filters: active, ending within 3 days, lapsed 14+ days. No new customer data is collected.
5. **Reports and Excel** — `/reports`, owner: tabs Overview, Programs, Time (weekday and hour of ordering),
   Sources, Payment methods, Renewals, Order history. Excel export for the open tab, for finance records and for
   payroll (`exceljs`, admin only). Dashboard gains income today, payment-method split and busy hours.
6. **Ingredients and purchases** — `/ingredients` (catalog: name in 3 locales, category, unit, usual price, pieces
   per pack, archive) and `/purchases` (receipt: date, buyer, cash/card, lines; history; analytics; ingredients ×
   days grid). A receipt creates exactly one `finance_entries` row in category ingredients and stays in step with it.
7. **Tech cards and dish cost** — `/tech-cards`: ingredients per 100 g of dish, method, notes; cost per portion
   follows the menu's grams. Cost per ration and margin per program and calorie level; cost-overrun list; PDF.
   Kitchen sheet gains a **shopping list** for the day. Purchases vs theoretical usage. Dishes are archived, not
   deleted.
8. **Finance analysis, round two** — backdate limit, full history with search and day totals, savings rate, daily
   burn, runway, all-time balance, flow by payment method with fee rates, records, then the Sankey view.
9. **Telegram, round two** — outbox table with retry; owner/investor group events (expense, purchase, order
   cancelled or edited, month close); morning digest by schedule; employee link by one-time code and salary
   notices with a "received" button. Needs: a second chat id and a webhook secret entered by the owner.
10. **Viewer role and live updates** — read-only `viewer` role for an investor or accountant (Finance read-only,
    no customer contacts); new-order badge and dashboard refresh without navigation.
11. **Attendance** — kiosk screen with a rotating QR, check-in through the bot, arrival status, today's lists,
    optional late fines. Depends on slice 9.
12. **Public pages** — `/corporate` (meal plans for teams, request form into orders as a lead), `/vacancies`,
    `/contacts` (hours, call, Telegram, map chooser). Needs real texts from the owner; built with honest
    placeholders hidden behind a "show on site" switch in Settings.
13. **Equipment register** — `/equipment`: name, photo, count, note, counted at / by, archive.
14. **Assistant** — read-only chat over finance and reports for the owner, through Vercel AI Gateway.
15. **Nightly backup** — encrypted dump to object storage with a failure alert.

## 3. Design rules (all slices)

- Admin kit only (`adm-*`, `kit/*`), no chart library, no cards inside cards, one primary button per surface, a
  failed load prints `—` and a notice.
- Three locales for every string; `formatSum` for money, integer UZS; days in `Asia/Tashkent`.
- Money and counting rules live once: SQL functions for aggregation, pure functions in `src/lib/admin/**`.
- Every new table has RLS with explicit policies; owner-only unless the slice says otherwise. No customer name,
  phone or address in Telegram messages or exports that leave the owner's account.
- Loading: `loading.tsx` skeleton per route. Empty states say what to do next.
- All migrations additive.

## 4. Risks

- **Volume of UI strings**: about 15 new screens × 3 locales. Uzbek Cyrillic is generated from Latin where the
  existing helper allows, then read by a person.
- **Tech-card costs are only as good as the usual prices**; the screens show "no cost" instead of zero when an
  ingredient has no price.
- **Manual orders bypass the public rate limits**; they are staff-only and marked `created_by`.
- **Telegram round two** needs a webhook and scheduled runs, the first server-side jobs in this project.
- **Admin screens have no e2e cover**; pure functions get script checks and migrations run on local Postgres.

## 5. Open questions (defaults are used until answered)

1. Payment methods on an order: cash, card, transfer (same three as finance records). Add Payme/Click as labels?
2. Who may create and edit orders: owner and manager (default).
3. Loyalty: zarkebab uses cashback cards. For taomiq the natural form is a renewal discount or referral credit.
   Not planned until decided.
4. Per-user feature switches as in zarkebab, or stay with fixed roles plus `viewer` (default)?
5. KPI bonus for staff from sales: not ported (default).
6. Corporate, vacancies and contacts pages need real text, address and hours.

## Build specs

### Slice 1 · Settings screen

- Route `src/app/admin/(panel)/settings/page.tsx` + `loading.tsx`, `requireOwner()`. Sidebar row `settings` in
  `src/app/admin/shell/nav.ts`, owner only, last group.
- Reads and writes `public.settings` with the session client (owner write policy from 0003; finance keys stay
  owner-read by 0015). Keys: existing `delivery_windows`, `order_cutoff_hour`, `cycle_anchor`, the three finance
  keys; new `contact_phone`, `contact_telegram` (strings, may be empty). Read how `submit_order` (0007) and the
  delivery page parse `delivery_windows` and keep that exact shape.
- A migration only if needed: seed the two new keys (`on conflict do nothing`) and a check trigger for the
  catalogue keys (cutoff 0–23, windows a non-empty array of well-formed from–to pairs, anchor a date), in the
  style of `settings_check_finance` in 0015.
- Server actions in `src/lib/admin/settings.ts`: one action per key, validated with the same rules as the trigger,
  returns a typed result; `revalidatePath` for the public pages that read the key.
- UI: sections Delivery (windows list: add, edit, remove, at least one must stay; cutoff hour), Menu (cycle start
  date with a warning that changing it shifts which day's menu is served), Contacts, Finance (the existing three
  fields; the close page keeps a link), Appearance (language, theme: reuse the existing controls), System
  (read-only: applied migrations if readable, which optional integrations are configured — names only, never
  values).
- Each control: its own Save, disabled until changed and valid; inline saved / failed state.
- Contacts are stored now and used by the public site in slice 12; nothing public changes in this slice.

### Slice 2 · Order operations

Today staff can only step the status and write one note. zarkebab's equivalents: staff-created orders, atomic bill
edits, payment method with audited changes, delete with a typed reason, actor tracking.

**Migration (next number, additive).**

- `orders` gains `payment_method text null check (payment_method in ('cash','card','transfer'))`,
  `cancel_reason text not null default ''`, `created_by uuid null references auth.users (id) on delete set null`
  (null = placed on the site).
- New table `order_events`: `id`, `order_id` (fk), `at timestamptz default now()`, `actor uuid null`,
  `actor_name text` (snapshot, so history survives a removed staff row), `kind` (`created`, `status`, `edited`,
  `payment_method`, `note`), `from_status`, `to_status`, `detail jsonb` (for `edited`: field → old/new; for
  `status` to cancelled: the reason; a note event carries no text). RLS on; select for the same roles that read
  orders today (see 0012: owner and manager); no insert/update/delete grants: rows are written only by a
  security-definer trigger on `orders` (after insert, after update). Index `(order_id, at)`.
- Status trigger rules added (extend `private.check_order_status` or a sibling trigger, keep `canMove()` in step):
  moving to `paid` requires `payment_method`; moving to `cancelled` requires `cancel_reason` of 3+ characters.
  Extend the column update grant with `payment_method`, `cancel_reason`. `payment_method` may be changed later
  only while the paying month is not closed (reuse the 0015 closed-month check if one applies to orders; if none
  exists, allow it and log the event).
- `staff_create_order(...)` security definer, owner or manager only: same price rule as `submit_order`
  (variant price × duration markup; factor the shared part into one private function rather than copying it),
  window must be one of `delivery_windows`, `start_date >= today (Tashkent)` (the public cutoff is not applied:
  staff know what the kitchen can do), phone format as the table check, status `confirmed`, `created_by =
  auth.uid()`, `source = {"ref":"staff"}`, no rate limits, no consent stamp beyond `now()`. Returns id and number.
- `staff_edit_order(p_id, ...)` security definer, owner or manager: name, phone, address, window, comment,
  exclusions in any open status (`new`…`active`); `start_date` and `weekdays_only` only before the first
  delivery day and never into the past. Program, days and price are not editable (cancel and create again).
  Stale-write guard: takes the `updated_at` the form was loaded with and fails with `stale` if it moved.

**Code.**

- `src/lib/admin/orders.ts`: `PAYMENT_METHODS`, `canEdit(status)`, `canEditSchedule(order, today)`, event types.
- `src/lib/admin/actions.ts` (or a new `order-actions.ts` if that file is getting long): `createOrder`,
  `editOrder`, `setOrderStatus` extended with method and reason, `changePaymentMethod`.
- `/orders/new`: program → calorie level → days → schedule → start date → window → name, phone, address, comment,
  exclusions, staff note. Price preview uses the existing pure price function from the public order form; the
  server is the authority. "New order" is the primary button in the orders list top bar.
- `/orders/[id]`: "Edit" opens `/orders/[id]/edit` (full page, Back + Save in the top bar, Save disabled until
  changed); "Mark paid" dialog asks the method; "Cancel order" dialog asks the reason and names the action on its
  button; payment method row with "Change" ; a **History** panel from `order_events` (who, when, what changed,
  newest first). Orders created by staff show "Added by {name}".
- The orders list shows the payment method on paid rows and a small "by staff" mark.
- Strings in three locales. `loading.tsx` for the new routes.

**Not in this slice:** split payments, refunds, deleting orders (cancel with a reason is the only removal),
customer notifications.

### Slice 3 · Audit page

zarkebab: `/admin/audit` (payment and order money changes), `accounting_record_audit`, `profile_role_audit`.

**Migration (next number, additive).**

- Table `audit_log`: `id bigint identity`, `at timestamptz default now()`, `actor uuid null`, `actor_name text`
  (snapshot), `area` (`finance`, `payroll`, `team`, `settings`, `catalog`), `action` (`added`, `changed`,
  `deleted`, `closed`, `reopened`, `approved`, `declined`, `role_changed`, `removed`), `subject text` (a short
  machine key such as `finance_entries:<id>` or `settings:order_cutoff_hour`), `summary jsonb` (the fields a
  person needs to recognise the row: amount, category, day, employee name, old → new value; never a secret).
  RLS: owner select only; no write grants. Indexes `(at desc)`, `(area, at desc)`.
- Security-definer triggers (after insert/update/delete) on `finance_entries`, `finance_salary_events`,
  `finance_salary_rates`, `finance_employees` (ended / resumed / renamed), `staff` (role change, removal),
  `staff_requests` (approved / declined), `settings` (value change; finance keys included because the reader is
  owner only), `programs` and `program_variants` (price and visibility changes only). Month close and reopen
  already live in `finance_close_log`; the page reads that table too instead of duplicating rows.
- A deleted finance record keeps its full summary in the log, so a deletion is never silent.
- Order history stays in `order_events` (slice 2). The audit page shows order events of kinds `status` to
  cancelled, `edited` and `payment_method` in the same list through one owner-only function
  `audit_feed(p_area, p_search, p_before, p_limit)` that unions the three sources and pages by time.

**Code.** `/audit`, `requireOwner()`, sidebar row in Business. Toolbar: search (actor, subject, amount), area
filter chips, 100 per page with "older" paging. Each row: time (Tashkent), who, a sentence built from `action` +
`summary` in the reader's language, and a link to the subject when it still exists. Empty and failed states.
`src/lib/admin/audit.ts` holds the sentence builder as a pure function.

### Slice 4 · Customers

zarkebab's closest screen is Loyalty (customer cards with history). taomiq has `profiles` and `orders` but no
customer view.

**Migration (next number, additive).**

- Table `customer_notes`: `phone text primary key` (same format check as `orders.phone`), `note text`,
  `updated_at`, `updated_by`. RLS: select and write for owner and manager.
- Function `customers_list(p_filter, p_search, p_limit, p_offset)` (security definer, owner or manager): one row
  per phone from `orders`, with the latest name, orders count, paid orders count, total paid (statuses paid,
  active, completed), first and last order date, the end date of the current plan (the same day-index rule the
  kitchen functions in 0009 use; reuse their helper), whether an account exists (`profiles.phone`), first
  `source.utm_source`/`ref`. Filters: `all`, `active` (a plan running today), `ending` (ends within 3 days),
  `lapsed` (last plan ended 14+ days ago, no open order), `new` (first order in the last 30 days).
  Managers get the same list; totals in money are returned only to the owner (null for a manager).
- Function `customer_orders(p_phone)`: that phone's orders, newest first.
- Index on `orders (phone)` exists (0004).

**Code.** `/customers` (owner, manager): toolbar with search (name, phone) and filter chips with counts, table
with name, phone (tap to call), orders, total (owner), last order, plan ends, status chip; 50 per page.
`/customers/[phone]`: header with the figures, the staff note (saves on its own), order history linking to each
order, and "New order for this customer" which opens `/orders/new` pre-filled (name, phone, last address and
window). Dashboard: the "ending within 3 days" tile links to `/customers?filter=ending`. Three locales.
No export in this slice (slice 5).

### Slice 5 · Reports and Excel

zarkebab: `/admin/reports` (Overview, Best selling, Sales by category, by hour, Payment methods, Order types,
Waiter performance, Order history) with Excel export; dashboard income, payment donut and busy hours.

**Migration (next number, additive).** One owner-only security-definer function per report, all taking
`p_from date, p_to date` (Tashkent days, at most 366 days), all on the cash basis used by finance (orders in
`paid`, `active`, `completed`, dated by `coalesce(paid_at, created_at)`), none returning customer data:

- `report_overview` — orders, revenue, average order value, average plan length, new vs returning customers
  (by phone: first paid order inside the period or before it), cancelled count and share, the same figures for
  the previous period of equal length.
- `report_programs` — per program and calorie level: orders, ration-days sold (`days`), revenue, share.
- `report_durations` — per plan length and per schedule (every day / weekdays).
- `report_time` — orders by weekday and by hour of `created_at` (when people order), 7 × 24 grid.
- `report_sources` — `source.utm_source` / `ref` (staff-added shown as its own line, direct when empty): orders,
  paid orders, revenue, conversion from placed to paid.
- `report_payment_methods` — count and revenue per method, "not recorded" for orders paid before slice 2.
- `report_renewals` — of customers whose plan ended in the period, how many placed another paid order within 14
  days; average gap in days.
- `report_staff` — per staff member: orders added by hand, status moves made (from `order_events`).

**Code.**

- `/reports`, `requireOwner()`, sidebar row in Business. Period picker in the top bar: presets (today, 7 days,
  30 days, this month, last month, this year) and custom from–to in `?from=&to=`; invalid input falls back to
  the last 30 days. Tabs in `?tab=`: Overview, Programs, Time, Sources, Payments, Renewals, Staff, Order history.
- Order history tab: paid orders in the period with number, paid day, program, days, total, method; links to the
  order; 50 per page.
- Kit: reuse `StatTile`, `ChangeBadge`, `BarChart`, `ProgressRow`; add `Heatmap` (weekday × hour, div grid with a
  visually hidden table) and `PeriodPicker`.
- Excel: add `exceljs`, imported only from a server route handler `src/app/admin/(panel)/reports/export/route.ts`
  (owner check, same period validation, `Content-Disposition` with an ASCII file name). One workbook per
  request: `?what=reports` (a sheet per tab), `?what=finance` (records of the period), `?what=payroll`
  (employees, rates, events of the period), `?what=orders` (order history **without** name, phone or address).
  Money cells are numbers, dates are dates, the header row is frozen. Extend the ESLint restricted-imports rule
  so the public site cannot import `exceljs`. An "Excel" button on Reports, Finance records and Payroll.
- Dashboard (owner block): revenue today vs yesterday at the same hour already exists as "value"; add a
  payment-method split for the last 30 days and the ordering-hours strip, and a "last updated" time.
- Three locales (sheet names and headers follow the staff language).

### Slice 6 · Ingredients and purchases

zarkebab: `/admin/ingredients` (catalog), `/admin/bazaar` (receipts, history, analytics),
`/admin/ingredients/sheet` (ingredients × days).

**Migration (next number, additive).**

- `ingredient_categories`: `id`, `name_uz`, `name_uzc`, `name_ru`, `sort`. Seeded with a basic set (meat and
  poultry, fish, dairy and eggs, vegetables, fruit and berries, grains and legumes, oils and sauces, spices,
  packaging, other). Owner can add more.
- `ingredients`: `id`, names in three locales, `category_id`, `unit` (`kg`, `l`, `pcs`, `pack`), `usual_price`
  (integer UZS per unit, null = unknown), `pieces_per_unit` (null or > 0, e.g. 30 eggs in a tray),
  `archived_at`, timestamps. Unique active name (case-insensitive, per `name_ru` and `name_uz`).
- `purchases`: `id`, `day date` (today or up to 3 days back, enforced in a trigger; a closed month refuses it as
  for finance records), `buyer_id` null → `finance_employees`, `buyer_name` snapshot, `payment_method`
  (cash, card, transfer), `note`, `total bigint`, `finance_entry_id` (unique), `request_id uuid unique`
  (idempotency), `created_by`, timestamps.
- `purchase_lines`: `purchase_id`, `ingredient_id`, `ingredient_name` snapshot, `unit` snapshot, `quantity
  numeric(12,3) > 0`, `amount bigint > 0`, `usual_price` snapshot. Unit cost is derived.
- RLS: owner and manager read and write ingredients, categories and purchases (the manager buys); **the linked
  finance entry stays owner-only**. Written only through functions:
  `purchase_save(p_request_id, p_id, p_day, p_buyer_id, p_method, p_note, p_lines jsonb)` creates or edits the
  receipt and its lines and creates or updates exactly one `finance_entries` row (category ingredients, amount =
  total, same day and method, counterparty = buyer); `purchase_delete(p_id)` removes both. A repeated
  `request_id` returns the first result. `finance_entries` rows that belong to a purchase cannot be edited or
  deleted from Finance records (trigger; the row shows a link to the purchase instead).
- `purchases_analytics(p_from, p_to)` and `purchase_grid(p_from, p_to)` (owner, manager).
- Audit: purchases appear in the audit feed (area `purchases`).

**Code.**

- `/ingredients` (Kitchen & stock group): search, category filter, Active / Archived, card or table; editor page
  with "fill Cyrillic from Latin" as in dishes; archive and restore (no delete).
- `/purchases` with tabs New / History / Analytics / Sheet:
  - New: day, buyer, method, note, lines (ingredient picker with search, quantity, unit shown, amount paid; unit
    cost and the difference from the usual price appear as you type, tone when above); running total; Save
    disabled until valid; "add ingredient" inline when it is not in the catalog (owner and manager).
  - History: search, category and method filters, paging, open, edit, delete with a confirm that names the action.
  - Analytics: total, average per day, receipts, distinct ingredients, days with purchases, daily bar chart, by
    category / method / buyer, top ingredients with average and latest unit cost and an up/down mark.
  - Sheet: ingredients × days grid for a month, tap a cell for quantity, amount, buyer, unit cost vs usual.
- Finance Month: food cost % keeps using ingredients spending; nothing changes in the formulas.
- Three locales; `loading.tsx` per route.

### Slice 7 · Tech cards, dish cost and the shopping list

zarkebab: `/admin/tech-cards` (recipe per dish, batch output, cost per portion, margin, cost-overrun list, PDF),
purchases vs theoretical usage, archive instead of delete. Depends on slice 6.

**Migration (next number, additive).**

- `tech_cards`: `dish_id` primary key → `dishes`, `batch_output_g int > 0` (cooked weight the recipe yields),
  `method text`, `notes text`, `updated_at`, `updated_by`.
- `tech_card_lines`: `dish_id`, `ingredient_id`, `quantity numeric(12,3) > 0`, `unit` (`g`, `ml`, `pcs`),
  `sort`. Unique `(dish_id, ingredient_id)`. The unit must be compatible with the ingredient's purchase unit
  (kg ↔ g, l ↔ ml, pcs ↔ pcs, pack ↔ pcs through `pieces_per_unit`), checked in a trigger.
- RLS: all staff read (cooks need the recipe); owner and manager write. **Prices are not in these tables**, so a
  cook never sees money.
- `dishes.archived_at timestamptz null` — archive instead of delete; an archived dish is hidden from pickers and
  from the public menu readers (treat as `active = false`), and the existing delete stays blocked while the dish
  is on the menu.
- Functions (security definer):
  - `dish_costs()` owner/manager: per dish, cost per 100 g = Σ(line quantity in purchase units × ingredient
    `usual_price`) / `batch_output_g` × 100; `complete` is false when a card is missing, has no lines, or any
    ingredient has no price. Incomplete cost is null, never zero.
  - `ration_costs(p_cycle_day int null)` owner: per calorie level and cycle day, Σ(menu grams × dish cost) for
    the five slots, the level's price per day, margin in UZS and %, and how many of the day's dishes lack a cost;
    plus the 30-day average per level.
  - `shopping_list(p_day date)` all staff, **quantities only**: firm rations for the day (the `kitchen_orders`
    rule) × menu grams ÷ batch output × recipe lines, summed per ingredient in purchase units, with the dishes
    that could not be counted (no card). Owner and manager variant `shopping_list_costed` adds usual price and
    amount.
  - `ingredient_usage(p_from, p_to)` owner/manager: bought (slice 6) vs theoretical use from delivered ration
    days in the period, and the difference. It is labelled as an estimate, not a stock balance.

**Code.**

- `/tech-cards` (Kitchen & stock): tiles (dishes, complete cards, need setup, average cost per 100 g — owner and
  manager only), search, All / Ready / Not complete filter. Editor page per dish: ingredient rows from the
  catalog (search, quantity, unit), batch output, method, notes; owner and manager see line cost, batch cost,
  cost per 100 g and per typical portion. Copy a recipe from another dish. A cook opens it read-only.
- The dish "verified tech card" flag stays a manual flag; the editor shows a hint when the flag is on but the
  card is not complete.
- `/kitchen`: new "Shopping list" block and print view for the day (and a "next 3 days" total), listing dishes
  that could not be counted.
- Finance → Month: a "Ration cost" panel (owner): average cost and margin per calorie level, and the
  cost-overrun list (levels or days where cost exceeds the price per day).
- `/purchases` gains a Usage tab (owner, manager).
- PDF of chosen tech cards (name, ingredients, method; cost only when the owner asks for it): print stylesheet
  first (`@media print`, as the kitchen sheet does); no PDF library unless print is not enough.
- Three locales; `loading.tsx` per route.

### Slice 8 · Finance analysis, round two

zarkebab: backdate limit, All Accounting history, indicators (savings rate, daily burn, runway, all-time
balance), flow by payment method with fee rates, records, Sankey.

**Migration (next number, additive).**

- Backdate rule for `finance_entries` and payroll events: the day may be today or up to N days back, N from a
  new owner setting `finance_backdate_days` (default 3; the Settings screen gets the field; 0–31). Enforced in
  the existing before-insert guards. Existing rows are not touched. The owner can raise N for a catch-up.
- `finance_fee_rates`: `method` (card, transfer), `rate_bp int` (basis points), `effective_from date`; owner
  only. Estimated bank fees = paid order totals by method × the rate in force that day; shown as an estimate and
  never written to the ledger.
- Functions (owner): `finance_history(p_from, p_to, p_search, p_kind, p_before, p_limit)` — every ledger row and
  payroll payment with day totals; `finance_indicators(p_month)` — money in, spent, left, savings rate
  (result / income), daily burn (spending / days elapsed), runway in days (all-time balance / daily burn, null
  when burn is 0), all-time balance (all income and investor money − all spending − salary paid);
  `finance_method_flow(p_from, p_to)` — in and out per payment method, with estimated fees;
  `finance_records()` — best month, best 10 days, best single day, longest run of profitable months.

**Code.**

- Finance → Records: "All history" view with search, kind filter, day headers with totals, paging; the add form
  refuses a day outside the window with a clear message naming the limit.
- Finance → Month: an Indicators row (savings rate, daily burn, runway, all-time balance) with "?" explainers;
  "By payment method" panel with fees.
- Finance → Year: Records panel; **Money flow** (Sankey: sources — orders, other income, investor — into the
  month, out to spending groups and result) as a hand-built SVG in `kit/Sankey.tsx` with a visually hidden table.
- Settings: backdate days, fee rates editor.
- Three locales. Formulas as pure functions in `src/lib/admin/finance/`.

### Slice 13 · Equipment register

zarkebab: `/admin/inventory` — equipment with name, photo, count, note, "counted at / by", archive; no count
history there. taomiq adds a short history because the audit pattern already exists.

**Migration (next number, additive).**

- `equipment`: `id`, `name` (1–120, unique among active rows, case-insensitive), `count int >= 0`, `note text`
  (≤ 500), `photo_url text null`, `counted_at timestamptz`, `counted_by uuid`, `counted_by_name text` (snapshot),
  `archived_at`, timestamps. `counted_*` are stamped by a trigger whenever `count` changes (and on insert); a
  client cannot set them.
- `equipment_events`: append-only (same guards as `purchase_events`): `equipment_id`, `at`, `actor`,
  `actor_name`, `kind` (`added`, `counted`, `renamed`, `archived`, `restored`), `detail jsonb` (count from → to,
  name from → to). Written by a trigger.
- RLS: owner and manager read and write `equipment` (insert, update of name / count / note / photo / archived);
  no delete. `equipment_events` readable by owner and manager. Cooks have no access.
- Storage: a new private bucket `equipment-photos` if the existing dish and program photo buckets are created by
  migrations (follow the same pattern and policies, owner and manager write); otherwise reuse the existing upload
  path the dish editor uses. Photos are resized in the browser before upload (max 1280 px, JPEG) if the dish
  uploader already does that; if not, apply the existing uploader's limits unchanged.
- Audit: equipment events appear in the owner's audit feed as area `equipment` (extend `audit_feed` with
  `create or replace`, identical signature, as slice 6 did for purchases).

**Code.** `/equipment` in Kitchen & stock (owner, manager): search, Active / Archived, cards with photo, name,
count, note, "counted {date} by {name}"; quick count control (minus, number, plus, Save disabled until changed)
that saves on its own; add and edit as a full page with the photo uploader; archive and restore with a confirm
that names the action; a History panel on the item page. Three locales; `loading.tsx` per route.

### Slice 10a · Live updates (the part of slice 10 that needs no new role)

zarkebab subscribes to realtime changes. taomiq's back office is server-rendered with no client data layer, so
the smallest honest version is a visibility-aware poll, not a socket.

- No migration. One owner/manager-safe server action already exists for the sidebar counts
  (`readNewOrderCount`, `readPendingRequestCount` in `src/lib/admin/actions.ts`).
- A small client component in the shell polls those counts every 30 s while the tab is visible (pause when
  hidden, refresh immediately on focus and on `online`), updates the sidebar badges, and when the new-order count
  rises shows a toast "New order" with a link to `/orders?status=new`, plays no sound, and updates the document
  title prefix `(N)`.
- On `/` (dashboard) and `/orders` the same signal triggers `router.refresh()` so tiles and the list show the new
  order without navigation; never while a dialog is open or a form on the page is dirty.
- A connection notice in the top bar when the poll fails twice in a row ("No connection — figures may be old"),
  cleared on the next success.
- Three locales.

### Slice 9a · Telegram round two: owner group events and the morning digest

zarkebab: database-first Telegram queue with delivery status and retry; an Investor group that hears about
expenses, purchases, order changes and month closes; a morning report. Split in two: **9a** (this spec) needs no
webhook; **9b** (employee link by one-time code, salary notices with a "received" button, attendance) needs the
bot webhook and comes after.

**What the owner sets outside the repo (nothing works until then, and nothing breaks without it).**

- `TELEGRAM_OWNER_CHAT_ID` — the chat id of the owner/investor group (the existing bot `TELEGRAM_BOT_TOKEN` is
  added to that group). Without it every message is recorded as skipped.
- `CRON_SECRET` — protects the daily endpoint. Entered by the owner in Vercel; never typed by an agent.

**Rules.**

- No customer name, phone, address, comment or exclusions in any message. Order messages carry the order number,
  program, calorie level, days, total and the staff member's name. Free text typed by staff (cancel reason, finance
  note, purchase note, close reason) is **not** sent; the message says "see the back office".
- A message is written to the database first, inside the same transaction as the change, then delivered. A
  failed delivery never fails the change.
- A timeout or a 5xx from Telegram means "maybe delivered": the row becomes `uncertain` and is not re-sent
  automatically (the owner can resend from Settings). A clear refusal (4xx other than 429) is `failed`; 429 and
  network refusals before the request was sent are retried, at most 5 attempts with growing gaps.
- Rows still pending after 24 hours are marked `skipped` (so switching the chat on later does not flood it).

**Migration (next number, additive).**

- `telegram_outbox`: `id bigint identity`, `created_at`, `kind` (`finance`, `investor`, `purchase`, `order`,
  `payroll`, `close`, `team`, `digest`, `test`), `dedupe_key text unique`, `payload jsonb` (facts only, no
  sentence: the app renders the text in the chosen language), `status` (`pending`, `sending`, `sent`, `failed`,
  `uncertain`, `skipped`), `attempts int`, `next_attempt_at`, `lease_until`, `last_error text` (a short code),
  `sent_at`. RLS on: owner select; no client writes at all. Indexes on `(status, next_attempt_at)` and
  `(created_at desc)`.
- Writers are security-definer triggers that reuse what already exists: after insert on `audit_log` (areas
  finance, payroll, team; the summary is already PII-free), on `purchase_events`, on `finance_close_log`, and on
  `order_events` for kinds `status` (to paid, to cancelled), `edited` (field names only) and `payment_method`.
  One outbox row per source row, `dedupe_key = '<source>:<id>'`. The trigger checks the owner's switches (below)
  and writes nothing for a switched-off kind. A trigger must never raise: wrap the insert so a failure here
  cannot roll back the owner's change, and say in the report how that was tested.
- Functions for the server (execute for `service_role` only): `telegram_claim(p_limit int)` — marks up to N due
  rows `sending` with a 2-minute lease (`for update skip locked`; an expired lease counts as `uncertain`, not
  pending) and returns them; `telegram_finish(p_id, p_status, p_error)`; `telegram_expire()` — pending older than
  24 h → `skipped`. For the owner: `telegram_resend(p_id)` (failed or uncertain → pending, new attempt count),
  `telegram_status()` (counts by status for the last 7 days and the latest 20 rows), `telegram_test()` (inserts
  one `test` row).
- `daily_digest(p_day date)` (execute for `service_role` only): the figures for the digest, as jsonb — yesterday:
  orders placed, orders paid and their sum, cancelled, expenses recorded, purchases, investor money; today:
  rations to cook per calorie level (the `kitchen_orders` rule), deliveries; plans ending within 3 days (the
  `customers_ending` rule); orders waiting in `new`; outbox rows failed or uncertain. No personal data.
- Settings keys (owner-only read through a new restrictive policy on prefix `telegram\_`, like the finance one in
  0015; validated by a check trigger): `telegram_owner_kinds` — a jsonb object of booleans per kind (default:
  finance, investor, purchase, order, close, digest on; payroll and team off), `telegram_owner_locale` (`ru`,
  `uz`, `uzc`; default `ru`).

**Code.**

- `src/lib/telegram/` (server-only): `send.ts` (one function to send text with the existing timeout rules and the
  sent / failed / uncertain / retry classification; reuse what `src/lib/order/telegram.ts` already does, without
  changing the order alert's behaviour), `render.ts` (pure: payload + locale → text, plain text with no markup
  parsing so staff-entered names cannot break formatting), `drain.ts` (claim → send → finish, at most 20 rows per
  run, stops early near the function's time limit).
- Delivery is triggered in-process with `after()` at the end of the server actions that cause events (finance
  record add/delete, payroll events, purchase save/delete, order status / edit / payment method, month close and
  reopen, team changes), and by the daily endpoint for anything left over. No minute-by-minute schedule.
- Daily endpoint: a route handler that checks `Authorization: Bearer <CRON_SECRET>` (constant-time compare, 401
  otherwise, and 503 when the secret is not configured), runs `telegram_expire`, builds the digest for the
  Tashkent day, queues it with `dedupe_key = 'digest:<day>'` (so a repeated call sends nothing twice) and drains.
  Schedule it once a day at 03:00 UTC (08:00 Tashkent) with Vercel's scheduler: read the current Vercel docs for
  scheduled jobs before choosing between `crons` and `schedules` in `vercel.json` and for the Hobby plan's limits
  (the project is on Hobby), and state what you chose and why. The path must be reachable on production and must
  not be rewritten by `src/proxy.ts` into a locale or admin path.
- Settings → new "Telegram" section (owner): what is configured (variable names only), a switch per kind,
  language, "Send a test message", the last 20 deliveries with status and time, counts of failed and uncertain
  with a "Send again" button per row. Three locales for the UI; message texts in the three locales too.
- `.env.example`: document `TELEGRAM_OWNER_CHAT_ID` and `CRON_SECRET`.

**Not in 9a:** PNG cards, messages to employees, the webhook, attendance, customer notifications.
