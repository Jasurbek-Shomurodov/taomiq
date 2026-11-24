# Plan · Kitchen day sheet and delivery sheet

Status: planned 24 Nov 2026, not built. Research: back-office comparison of 24 Nov 2026. PrivateCRM (read live) builds its production task from active subscriptions and updates it when a subscription changes; UnitFood produces one cooking sheet per day with portions and kilograms; Sprwt and Bottle add labels and packing slips (search summaries only).

## Goal

The back office answers two questions for any date, by default tomorrow:

- **Kitchen:** what do we cook, how many portions of each dish, at what weight, and which orders have exclusions?
- **Delivery:** who gets a ration, where, in which window?

Both come from data the system already has (orders, the 30-day menu, the cycle anchor) and both print on A4. Nothing is entered by hand.

## User flow

**Cook or admin** opens **Kitchen → Production** (`/kitchen`). The page shows tomorrow (Tashkent date + 1). Arrows and a date field move to another day. They see how many rations are due in total and per calorie level, then one block per meal slot listing each dish with its portions and total kilograms, then the exclusions list. **Print** gives a clean sheet. They never see a name, phone or address.

**Owner** opens **Sales → Deliveries** (`/deliveries`) for the same date: deliveries grouped by window, each with name, phone (tap to call), address, comment, program and "day 3 of 14". First and last days are marked. **Print** gives the route sheet.

## Which orders count on a date

An order delivers on date `D` when all of these hold:

- status is `paid` or `active` (**firm**), or `confirmed` (**awaiting payment**, shown separately, never added to the cooking totals);
- `D >= start_date`;
- if `weekdays_only`, `D` is Monday to Friday (same rule as `isWeekend()` in `src/lib/order/rules.ts` and `isodow in (6, 7)` in `submit_order`);
- its **day index** on `D` is at most `days`. Day index = the number of delivery days from `start_date` to `D` inclusive: calendar days, or weekdays only for a weekdays-only order.

So a 7-day weekdays-only order starting Monday 7 Dec delivers 7–11 Dec and 14–15 Dec. An order left in `paid` or `active` after its last day simply stops appearing; no status automation is part of this plan.

The menu for `D` is cycle day `cycleDayFor(D, cycle_anchor)` (`src/lib/data/types.ts`), per calorie level (`orders.variant_id` → `menu_items`).

This rule lives **once, in SQL** (below). TypeScript never re-implements it.

## Architecture

| Piece | Where |
|---|---|
| Date rule and the two readers | migration (functions below) |
| Calls + pure aggregation (`buildProductionSheet`) | new `src/lib/admin/kitchen.ts` |
| Production page, all staff | new `src/app/admin/(panel)/kitchen/page.tsx` + `loading.tsx` |
| Delivery page, owner only (`requireOwner`) | new `src/app/admin/(panel)/deliveries/page.tsx` + `loading.tsx` |
| Day switcher (prev / date field / next, `?date=YYYY-MM-DD`) and Print button | new `src/app/admin/kit/DaySwitcher.tsx`, `PrintButton.tsx` |
| Sidebar rows | `src/app/admin/shell/nav.ts`: `production` (group `kitchen`, all staff), `deliveries` (group `sales`, `ownerOnly`) |
| Print styles | `src/app/admin/admin.css`, `@media print` |
| Strings | `src/i18n/admin/{ru,uz,uzc}.ts` |

- Both pages are server components reading with the session client, like the rest of the panel. `searchParams` is read the way this Next.js version requires (check `node_modules/next/dist/docs/`); an invalid or out-of-range date falls back to tomorrow. Allowed range: 30 days back, 60 days ahead (the order form's own limit).
- `buildProductionSheet(orders, menuItems, dishes, variants)` is a pure function: it groups firm orders by `variant_id`, multiplies each menu line by that count, and merges lines by slot → dish → weight. Output per slot: dish name (staff language), lines `weight × portions`, total portions, total kg. It also returns the per-level ration counts and the list of problems.
- **Problems are shown, not hidden**, in a `Notice` at the top: a calorie level that has firm orders but no menu for that cycle day; a menu line whose dish is inactive or has no verified technological card.
- Menu rows and dishes are read with the existing staff-readable tables (`menu_items`, `dishes`, `programs`); only order data goes through the new functions.

## Data model — one additive migration (next number in sequence)

No table changes. One index and three functions.

```sql
create index orders_status_start on public.orders (status, start_date);
```

**`private.order_day_index(p_start date, p_weekdays_only boolean, p_date date) returns int`** — immutable, `set search_path = ''`. Returns null when `p_date < p_start` or when the order is weekdays-only and `p_date` is a weekend; otherwise the day index defined above (weekday count by `generate_series`, the span is at most a few months).

**`public.kitchen_orders(p_date date)`** — `security definer`, `stable`, `set search_path = ''`. Returns rows only if `public.is_staff()`; otherwise returns nothing. Columns: `number, variant_id, status, day_index, days, exclusions`. **No name, phone, address, comment or note.** Rows: status in `('confirmed', 'paid', 'active')` and `day_index between 1 and days`.

**`public.delivery_orders(p_date date)`** — `security definer`, `stable`, `set search_path = ''`. Returns rows only if `private.is_owner()`. Columns: `id, number, status, program_name, kcal, variant_id, day_index, days, customer_name, phone, address, delivery_window, comment, exclusions, staff_note`. Same row filter.

For both: `revoke all … from public, anon; grant execute … to authenticated;`.

Why functions and not a new policy: `orders` is readable by the owner only (`0004_orders.sql`), deliberately, so cooks never see personal data. A row policy for staff would expose every column of the row. A definer function that returns a fixed list of harmless columns is the pattern `my_orders()` already uses (`0007_orders_on_accounts.sql`); the Supabase advisor will warn about a definer function callable by `authenticated`, which is intended here for the same reason. The owner's function is a definer too, only so both sheets share one date rule; it checks the role itself.

Non-destructive: branch test, advisors, then production automatically.

## Design rules

- **Layout, production:** top bar title with the date and weekday ("Wed, 25.11.2026 · cycle day 25"); `DaySwitcher` and `PrintButton` in the top-bar slot. `StatTile` row: rations to cook, awaiting payment, orders with exclusions. Then a stack of `Panel`s, one per slot in `SLOTS` order, each a table: dish, weight, portions, kg. Then the exclusions panel: `#1004 · BALANCE 1800 · без орехов`.
- **Layout, deliveries:** one `Panel` per delivery window in the order of the `delivery_windows` setting (unknown windows last). Rows sorted by address. Each row: number (link to the order), name, phone as `tel:` link formatted with `formatPhone`, address, comment, program / kcal, "day N of M", badges **first day** and **last day**. On phones the table becomes stacked cards, like the orders list.
- **States:** loading skeleton (`loading.tsx`); empty ("No rations on this date", with the date); error per read, in the style of `OrdersOverview` (a failed read shows "—" and a notice, never 0).
- **Print:** `@media print` hides the sidebar, top bar, switcher and buttons; white background, black text, table borders, 11–12 pt, no cards or shadows; a header line with TAOMIQ, the sheet name, the date and the print time; panels avoid breaking inside a row. The delivery sheet prints a tick box per row.
- **Locales:** all labels in `ru`, `uz`, `uzc`; dish names in the staff member's language through the existing localisation helper; dates through `formatDay`. Customer text (address, comment, exclusions) is printed as typed.
- **Time:** every "today" and "tomorrow" is the Tashkent date, as in `stats.ts`.
- Mobile first: the production sheet must be readable on a phone held in a kitchen (large numerals, `tabular-nums`).

## Slices

1. **Production sheet.** Migration (index, `order_day_index`, `kitchen_orders`), `kitchen.ts`, `/kitchen`, `DaySwitcher`, `PrintButton`, nav row, print styles, strings. Reviewer: yes (definer function over order data).
2. **Delivery sheet.** Migration with `delivery_orders` (or the same migration if slices 1 and 2 are built together), `/deliveries`, nav row, print layout. Reviewer: yes (personal data).
3. **Overview tiles.** On the dashboard: "Tomorrow: N rations" linking to `/kitchen`, and for the owner "Ending within 3 days: N" linking to the delivery sheet of that day. No migration. Reviewer: optional.

Each slice leaves `main` working. Verification for 1 and 2 on the Supabase branch: seed three orders (every day; weekdays-only across a weekend; one past its last day) and check the function output for five dates before applying to production.

## Later, not in this plan

Freeze and moved days (a skips table that `order_day_index` then reads), structured exclusions instead of free text, container labels, a recipe table with a purchase list and food cost, cook / courier / manager roles, a courier link in Telegram, districts and route order. The functions above are written so a skips table can be added without changing the pages.

## Risks and open questions

- **The sheet is empty until the catalogue is filled.** On 24 Nov 2026 production had 0 dishes and 0 of 30 menu days. The page will say so through the "no menu for this level" notice; it is still correct to build first.
- **Awaiting-payment orders.** Planned default: `confirmed` orders are shown as a separate count and do not enter the cooking totals. If the kitchen should cook for them anyway, say so before slice 1.
- **Exclusions are free text** typed by the customer and are shown to cooks next to an order number. They could contain something personal. Accepted for now; structured exclusions are listed under "Later".
- **Calorie levels with four meals** (LIGHT 1200): the sheet trusts `menu_items`. If a fifth slot is filled in the menu by mistake, it will be cooked. The menu editor, not this page, should prevent that.
- **No courier role yet.** Only the owner can open and print the delivery sheet. If a manager should, the role work comes first.
- Uncommitted back-office changes were in the working tree on 24 Nov 2026 (orders page, search field, dishes browser, dictionaries). The builder must not revert them; the shipper commits only this plan's files, and `nav.ts` and the dictionaries need care because both efforts touch them.
