# Plan · Second port from zarkebab: everything that fits a meal-plan business

Status: planned 25 Nov 2026. Source: a full read of `~/Desktop/zar-kebab-pos` (routes in `src/App.jsx`,
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
