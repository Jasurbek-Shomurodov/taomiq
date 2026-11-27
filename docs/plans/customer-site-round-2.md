# Research · Round 2: UI, UX, logic, navigation and database (28 Nov 2026)

This follows [customer-site-improvements.md](customer-site-improvements.md) (round 1) and
[site-ux-navigation-pass.md](site-ux-navigation-pass.md), which shipped on 27 Nov in `a714709`: the programs
page, breadcrumbs, Prices in the menu, empty-menu states, the order-step Telegram link and the focus fix. It
also uses the live-site review in the project file `reviews/live-site-review-2026-11-27.md`.

What I checked, all read only:
- The Supabase security and performance advisors.
- The public schema.
- Every `SECURITY DEFINER` function's guard.
- The `submit_order` function.
- How the site's promises map to data.

## Database: what is healthy

- RLS is on for every public table.
- **All 59 "signed-in users can execute SECURITY DEFINER" warnings are guarded.** Each function opens with
  `private.is_owner()`, `is_staff()`, `can_handle_orders()` or `can_handle_stock()`, or filters by
  `auth.uid()` (`my_orders`). None can be run by `anon`. The three Telegram worker functions with no check are
  not executable by `authenticated` either. A signed-in customer can call none of them for data. This is
  noise, not a hole.
- `submit_order` re-prices on the server and checks the cutoff, phone format, window and locale. It
  rate-limits by phone (3 new orders in 24 h) and by IP hash (10 per hour). It snapshots the program name,
  kcal and price on the order. That is good practice.
- **Small items:**
  - `menu_items.dish_id` has no index. One line in the next migration.
  - 35 indexes show as "unused", only because there is no traffic yet. Keep them.
  - The "multiple permissive policies" findings are irrelevant at this size.
  - Leaked-password protection needs the Pro plan (known).

## Where the site promises more than the data can hold

These are the main logic gaps. The home page and the goal pages promise these things under "Already
included in the price", but the database has nowhere to record them.

| Promise on the site | What the data has | Gap |
|---|---|---|
| "Pause and move days without losing what you paid" | `orders` holds `start_date` and `days`, and the end date is computed | There are no pauses or skipped days, so a pause can only be done by staff editing the start date, which shifts every day |
| "Dish swaps and up to 3 exclusions" | `orders.exclusions` is free text, and `dishes.allergens` is an array that is never used for filtering | No structured exclusions, no swap rule, no allergen filter on the menu |
| Repeat customers | `profiles` holds name and phone only | No saved address or window, so every new order means typing the address again |
| One order per tap | `submit_order` has no request key | A double submit on a slow network can create two orders. The rate limit only stops the 4th |
| Program comparison (protein, who it's for) | `programs` has tagline and description only | Comparison text lives in the code dictionaries, so the back office can't edit it |
| Online payment (roadmap) | `orders.paid_at` and `payment_method` | No payment-attempt table (provider id, amount, status, idempotency). Needed before Payme/Click |

## Prioritised list

Effort: S is up to a day, M is 2 to 4 days, L is a week or more. ⚠ marks a data model change or a design
decision for the owner.

| # | Improvement | Impact | Effort | Needs |
|---|---|---|---|---|
| 1 | **One calculator** (already planned, slice 4) with the review's fixes: nearest level, a warning far above the biggest ration, one protein rule, an 18+ message | High | M | Your go (asked 27 Nov) |
| 2 | **Make "Already included" honest today.** Reword pause and swaps to what is true now ("pause by message before 14:00 the day before; swaps arranged with the manager"), until #4 exists. Fix the FAQ answer that leaves out sex and goal | High (trust) | S | Copy only |
| 3 | ⚠ **One order per tap.** A `request_id` uuid column with a unique index on orders, sent by the form and checked in `submit_order`, so a retry returns the same order number. Add the `menu_items.dish_id` index in the same migration | Medium | S | Additive migration |
| 4 | ⚠ **Pause and skip days.** An `order_pauses` table (order, from, to, created by), and the end date and the kitchen and delivery sheets count the pauses. First staff-entered, then a customer button in the account with the 14:00 cutoff | High (retention; it's a promise) | M–L | Migration + design |
| 5 | ⚠ **Saved delivery details.** Address, entrance, floor, landmark and window on `profiles` (or a `customer_addresses` table), prefilled for signed-in customers, plus "Repeat last order" on the account page | High for repeat orders | M | Migration |
| 6 | ⚠ **Structured exclusions and an allergen filter.** Allergen chips (nuts, dairy, gluten, eggs, fish, sesame…) in the order form saved as an array, a menu filter that highlights dishes with a chosen allergen, and these allergens shown on the kitchen sheet | Medium–high | M | Migration |
| 7 | **Menu page fixes from the review.** Render the program from `?program=` on the server (no BALANCE flash). Label the day picker as "Menu day N of 30", not the calendar date | Medium | S | Code |
| 8 | **Copy polish:** localise "PREMIUM DAILY NUTRITION" (or keep it as a deliberate brand line; your call), and say "2-day trial at the weekly price" so it doesn't read like a discount | Low–medium | S | Your call on the English line |
| 9 | ⚠ **Program fields in the database:** protein grams per day per level and "who it's for", editable in the back office, so the comparison and program pages show real numbers | Medium | S–M | Migration + your numbers |
| 10 | ⚠ **Payments table ahead of Payme/Click:** `payments` (order, provider, provider id, amount, status, raw callback, timestamps, unique provider id). Payme and Click both require idempotent callbacks | Very high later | M | Waits on merchant contracts |
| 11 | **Order status for the customer:** the account shows "Confirmed / Paid / Active day 3 of 7 / Ends 5 Dec" from existing fields, plus a renewal nudge 2 days before the end | Medium | S | Code only |

## Suggested order

1. **Code only, now:** #1 (after your go), #2, #7 and #11.
2. **One small additive migration:** #3.
3. **Each needs a short plan and your OK on the data model:** #5, #4 and #6.
4. **Later:** #9 and #10, as numbers and contracts arrive.
