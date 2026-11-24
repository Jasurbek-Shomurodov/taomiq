# Finance, investor reporting and payroll

Port of the money side of `zar-kebab-pos` (Desktop/zar-kebab-pos) into the taomiq back office. The source app is Vite + React with ~285 migrations; nothing is copied file for file. We take its **data model ideas, formulas and screen structure** and rebuild them in the taomiq patterns (server components, `adm-*` kit, three locales, owner RLS).

## Goal

The owner opens **Finance** in the back office and can:

1. Record every expense and every non-order income (investor money first of all).
2. See a month: income, spending, result, margins, where the money went, against the previous month.
3. See a year: a 12-month statement, growth, and the investor view — how much was invested, how much the business has generated back, payback progress and pace.
4. Read a plain-language "?" explanation for every figure, so the screen can be shown to an investor as is.
5. Run payroll: employees, daily or monthly rates, payments, bonuses, fines, absences, what is owed today.
6. Close a month into a frozen official result.

Today taomiq has **no finance data at all**: only `orders.total` (integer UZS), no paid date, no expenses, no staff pay.

## What is taken from zarkebab, and what is not

| zarkebab feature | taomiq |
|---|---|
| `expenses` ledger with `entry_type` income/expense, categories, `investor_support` income | Slice 1, `finance_entries` |
| Accounting history grouped by day, delete with audit | Slice 1 (history + delete; audit via month close lock in slice 4) |
| Financial analysis, Monthly tab: KPIs vs previous period, indicators, categories, largest payments, daily chart | Slice 2 |
| Financial analysis, Overall tab: monthly statement, growth, period totals, records | Slice 2 |
| Investor support panel, payback, investor overview, HELP explainers (uz/ru/en) | Slice 2 (uz/uzc/ru) |
| Payroll ledger: effective-dated daily/monthly rates, exact monthly allocation, payments, accruing bonuses, fines, absences, advance = negative balance | Slice 3 |
| Owner profit month close (frozen P&L, sequential, lock, reopen with reason) | Slice 4 |
| Monthly estimate (pace forecast, required daily sales), break-even target | Slice 4 |
| Excel export | Later, own plan (admin-portal-upgrade.md:134) |
| Bazaar receipts, employee meals, attendance QR, late fines, KPI % bonus, loyalty, Telegram investor group, payment-method flow, Sankey | Not ported |

Per-dish cost (COGS snapshots) is not ported: taomiq has no recipe costs. Food cost % is `ingredients spending / revenue`, the same way zarkebab's `foodCostPct` uses Bazaar spending.

## Decisions (defaults; see Open questions)

- **Owner only.** Pages gate with `requireOwner()`, tables with `private.is_owner()`. Managers and admins never see Finance. No new role, so no destructive constraint change.
- **No investor login.** As in zarkebab, an investor is not a user. The owner shows or screenshots the screen. Each investor contribution carries the investor's name in `counterparty`; the year view totals per name.
- **Cash basis.** Revenue = `orders.total` of orders in status `paid`, `active` or `completed`, dated by `coalesce(paid_at, created_at)` as a Tashkent day. Investor money is shown separately and is **never** counted as income or profit.
- **Money** is integer UZS (`bigint` in sums), shown with `formatSum` + `t.common.currency`, `tabular-nums whitespace-nowrap`.
- **Time** is `Asia/Tashkent` everywhere (reuse `tashkentDay`, `addDays` from `src/lib/admin/stats.ts`).
- **Aggregation in SQL functions**, not row paging in TypeScript (the 5000-row cap in `stats.ts` is not acceptable for money).
- **No chart library.** `kit/BarChart`, `ProgressRow`, `StatTile`, `ChangeBadge`; new small kit pieces where needed.
- **Formulas live once** in `src/lib/admin/finance/*.ts` as pure functions (no Supabase import), so pages never repeat money math.

## User flow

`/finance` (admin host; nav row "Finance" in group `business`, `roles: OWNER`, icon `Wallet`).
Top-bar tabs (`TopBarTabs`): **Month** `/finance` · **Year** `/finance/year` · **Records** `/finance/records` · **Payroll** `/finance/payroll` (slice 3) · **Month close** `/finance/close` (slice 4).

- **Records**: one form (type: expense / investor money / other income; date, category, method, amount, counterparty, note) and the history grouped by day with a type filter in the URL and delete behind `ConfirmDialog`.
- **Month**: month switcher (`?m=YYYY-MM`, modelled on `kit/DaySwitcher`), KPI tiles with change against the previous month, indicators, spending by category, largest payments, daily revenue chart.
- **Year**: investor panel, growth tiles, result-by-month chart, monthly statement table with a total row.

## Architecture

```
src/app/admin/(panel)/finance/
  layout.tsx            requireOwner + TopBarTitle + TopBarTabs
  page.tsx, loading.tsx           Month
  year/page.tsx, loading.tsx      Year
  records/page.tsx, loading.tsx   Records
  records/EntryForm.tsx           client, useActionState
  records/DeleteEntry.tsx         client
  payroll/…                       slice 3
  close/…                         slice 4
  HelpButton.tsx                  client "?" + dialog (base-ui Dialog, as ConfirmDialog does)
src/app/admin/kit/MonthSwitcher.tsx
src/lib/admin/finance/
  categories.ts   client-safe: category lists, type → categories, icon/tone
  math.ts         pure formulas (below)
  queries.ts      server-only loaders taking a SupabaseClient, throw on error
  actions.ts      "use server": addEntry, deleteEntry (+ payroll, close later)
src/i18n/admin/{ru,uz,uzc}.ts     new `finance` section + nav.finance
```

Follow the existing patterns exactly: `team/page.tsx` (gate, `Promise.all` loaders in try/catch, `Notice` with retry), `OrdersOverview.tsx` (tiles + chart), `src/lib/admin/actions.ts` (`FormState`, gate → validate → write → `refresh()`), `createSessionClient()` only — **never the secret client**. Read `node_modules/next/dist/docs/` first (AGENTS.md).

## Data model

### Migration `0013_finance_ledger.sql` (slice 1, additive only)

```sql
-- orders: when the money came in
alter table public.orders add column paid_at timestamptz;
-- before-update trigger private.stamp_order_paid_at(): when status changes to 'paid'
-- and paid_at is null, set paid_at = now(). No backfill (existing rows keep null and
-- reports fall back to created_at) — a backfill would be an UPDATE of existing rows.

create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('expense','income')),
  entry_date date not null,
  category text not null,
  payment_method text not null default 'cash' check (payment_method in ('cash','card','transfer')),
  amount bigint not null check (amount > 0 and amount <= 100000000000),
  counterparty text check (char_length(counterparty) <= 120),
  note text check (char_length(note) <= 500),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint finance_entries_category_check check (
    (entry_type = 'expense' and category in ('ingredients','packaging','delivery','rent',
      'utilities','marketing','equipment','repair','tax','payment_fees','software',
      'salary_one_time','investment','other'))
    or (entry_type = 'income' and category in ('investor_support','other_income'))),
  constraint finance_entries_date_check check (entry_date >= date '2024-01-01')
);
create index finance_entries_date_idx on public.finance_entries (entry_date desc, created_at desc);
```

RLS on; `revoke all … from anon, authenticated`; `grant select, insert, delete` to authenticated; three policies (select / insert with check / delete) all `(select private.is_owner())`. No update grant: a wrong row is deleted and entered again. The insert policy also checks `entry_date <= (now() at time zone 'Asia/Tashkent')::date`.

Functions (`public`, `stable`, `security definer`, `set search_path = ''`, first line raises `not_owner` 42501 unless `private.is_owner()`, revoke from public/anon, grant execute to authenticated):

- `finance_monthly_cashflow(p_months int default 12)` → rows, oldest first, one per Tashkent month for the last `p_months` months (clamped 1..36) including the current: `month_start date, revenue bigint, order_count int, investor_support bigint, other_income bigint, expenses bigint, salaries bigint` (salaries = 0 until slice 3 replaces the function; `salary_one_time` entries are already inside `expenses`).
- `finance_totals()` → one row, all time: `investor_support, revenue, other_income, expenses, salaries, first_order_day date, first_investment_day date`.
- `finance_period(p_from date, p_to date)` → `jsonb`: `{ revenue, order_count, by_day: [{day, revenue, spent}], expense_by_category: {…}, income_by_category: {…}, investors: [{name, amount}], largest: [top 10 expense entries] }`. Range limited to 366 days.

Revenue rule in all three: `status in ('paid','active','completed')`, day = `(coalesce(paid_at, created_at) at time zone 'Asia/Tashkent')::date`.

### Migration `0014_payroll.sql` (slice 3, additive only)

- `finance_employees`: `id, name, job_title, joined_at date, ended_at date null (>= joined_at), is_active bool, staff_user_id uuid null → auth.users, created_at`.
- `finance_salary_rates`: `id, employee_id → cascade, effective_from date, amount bigint > 0, rate_unit in ('daily','monthly'), note, created_at`, unique `(employee_id, effective_from)`.
- `finance_salary_events`: `id, employee_id, kind in ('payment','bonus','fine','absence'), event_date, amount bigint (> 0, null only for absence), payment_method (payment only), note (required for fine), created_by, created_at`; unique `(employee_id, event_date)` where `kind = 'absence'`.
- Same owner-only RLS. `create or replace` `finance_monthly_cashflow`, `finance_totals`, `finance_period` so `salaries` = salary payments and they join spending. New `finance_payroll(p_as_of date)` → per employee: accrued, bonuses, fines, paid, balance.

### Migration `0015_month_close.sql` (slice 4, additive only)

- `finance_month_closes`: frozen components per month (`revenue, other_income, investor_support, expenses, salary_earned, salary_breakdown jsonb, result, closed_by, closed_at`), `month_start` unique; no client grants, written only by `close_finance_month` / `reopen_finance_month(reason)`; update/delete blocked by trigger except reopen of the latest month.
- Guard triggers on `finance_entries` and `finance_salary_events`: no insert/delete dated in a closed month.
- `settings` keys `finance_monthly_rent`, `finance_break_even_daily`, `finance_tax_rate_pct`.

## Formulas (`src/lib/admin/finance/math.ts`)

Month row (from `finance_monthly_cashflow`), investor money excluded from income:

```
income = revenue + other_income
spent  = expenses + salaries
result = income - spent
marginPct = income > 0 ? result / income * 100 : null
```

Percent change: `(now - before) / |before| * 100`, `null` when `before = 0` (reuse `percentChange` from `stats.ts`).

Month indicators:

```
avgRevenuePerDay = revenue / daysCounted        // current month: days up to today
avgCheck         = revenue / order_count
foodCostPct      = expense_by_category.ingredients / revenue
payrollSharePct  = (salaries + salary_one_time) / spent
investorDependencePct = investor_support / (income + investor_support)
shortfall        = max(0, spent - income)
```

Payback (zarkebab `buildPaybackSummary`):

```
invested    = totals.investor_support
generated   = totals.revenue + totals.other_income - totals.expenses - totals.salaries
monthlyPace = average result of the last 3 completed months (current month excluded)
remaining   = max(0, invested - max(0, generated))
paidBackPct = invested > 0 ? min(100, max(0, generated) / invested * 100) : null
monthsLeft  = remaining == 0 ? 0 : monthlyPace > 0 ? ceil(remaining / monthlyPace) : null
```

Year totals: sums over the 12 rows; `profitableMonths` = completed months with result > 0; best and worst completed month. Growth: average revenue per day of the latest completed month against the previous one and against three months before; average monthly growth `((last/first)^(1/(n-1)) - 1) * 100` over completed months with revenue > 0 (null with fewer than 2).

Payroll (slice 3, zarkebab `expenses.js`):

```
daily pay(date): daily rate → amount
                 monthly rate → base = floor(m / daysInMonth); day <= m % daysInMonth ? base + 1 : base
rate for a date = latest effective_from <= date; 0 outside joined_at..ended_at and on absence days
balance = Σ daily pay (joined..as_of) + Σ bonuses − Σ fines − Σ payments
due = max(0, balance)          // negative balance = advance, shown as such
```

Month close (slice 4): `result = revenue + other_income − expenses(without salary payments) − salary_earned`, where salary earned = accrued pay + bonuses − fines dated in the month.

## Design rules

- Only `adm-*` tokens and classes (dark theme works for free). One primary button per surface, no card inside a card. Phone first: tables become stacked cards under `sm`, as `OrdersTable.tsx`.
- States: `loading.tsx` with `PageSkeleton layout="dashboard"` (Records: `"table"`); empty state with a link to Records when a period has no entries and no orders; load failure → `Notice tone="negative"` with retry; an unknown figure renders `—`, never `0`.
- Result figures: positive `positive` tone, negative `negative` tone. Investor money always uses the `info` tone and the caption says it is not income.
- Every string in `ru.ts`, `uz.ts`, `uzc.ts` under `finance` (`scripts/check-translit.mjs` must pass). Help texts: a `finance.help` map `{ title, body }` per figure — invested, generated, paidBack, pace, monthsLeft, revenue, otherIncome, spent, result, margin, foodCost, payrollShare, avgCheck, avgPerDay, investorDependence, shortfall, growth, statement. Two or three plain sentences each: what it is, how it is counted, what is left out.
- Fix the wrong migration number in the header comments of `src/lib/admin/roles.ts` and `auth.ts` only if touched.

## Slices

1. **Ledger and records.** Migration 0013 (whole file, including the three functions). Nav row, `finance/layout.tsx`, Records page with form, history, filter, delete. `categories.ts`, `actions.ts`, `queries.ts` (list entries by month with paging through `range`). Month and Year tabs exist as pages that show only the three headline tiles for the current month (revenue, spent, result) from `finance_monthly_cashflow(1)` so the tabs are not dead. Dictionaries.
2. **Month and year analysis, investor view.** `math.ts`, `MonthSwitcher`, full Month page, full Year page with the investor panel, `HelpButton` and all help texts. No migration.
3. **Payroll.** Migration 0014, Payroll tab: employees list with balance and due, add employee, change rate, record payment / bonus / fine / absence, per-employee history. Salaries flow into Month and Year.
4. **Month close, estimate, break-even.** Migration 0015, Month close tab, forecast tile on Month (pace projection, required daily revenue), break-even line on the daily chart, finance settings.

Each slice leaves `main` working. Slices 1, 3 and 4 touch RLS and money → reviewer always; slice 2 → reviewer for the formulas.

## Risks and open questions

Defaults are chosen so building does not wait; say so to change them.

1. **Investor login.** Default: none (owner shows the Year tab). A read-only investor role would need a destructive change of `staff_role_check` and its own plan.
2. **Several investors with shares / dividends.** Default: contributions are totalled per investor name; no ownership %, no payouts ledger. Month close (slice 4) is where a profit distribution would attach.
3. **Old orders have no paid date**, so they count on their creation day. A one-off backfill (`paid_at = created_at` for paid orders) is an UPDATE of existing rows and needs a yes.
4. **Refunds and cancelled-after-paid** orders drop out of revenue entirely; partial refunds are not modelled (docs/08 #14 is still open). Record a refund as an expense in `other` until then.
5. **Managers can read `orders.total` through RLS today** (0012). Finance tables and functions are owner-only, so nothing new leaks, but the existing exposure stays.
6. **Tax**: no engine; `tax` is an expense category. The 4% estimate zarkebab uses is not assumed; slice 4 makes the rate a setting.
7. **Admin pages are not covered by Playwright** (demo mode redirects to `/setup`). Formulas are pure functions; the migration is exercised by `scripts/test-migrations.sh` with RLS checks as `authenticated` owner / non-owner.
