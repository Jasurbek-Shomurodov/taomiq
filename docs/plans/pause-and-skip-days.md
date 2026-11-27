# Plan · Pause and skip delivery days


Status: slices 1-2 shipped (migration 0028, staff pauses, customer account end date). Slice 3 (customer self-service pauses) is next.
Approved for planning by Jasurbek on 27 Nov 2026 (round-two research, item 4). The site lists "Pause and move
days without losing what you paid" under "Already included". Today nothing in the data can hold a pause:
`orders` has `start_date`, `days` and `weekdays_only`, and every sheet derives the delivery days from those
through `private.order_day_index` and `private.order_end_date`.

## Goal and user flow

1. **Staff first (slice 2).** On `/orders/[id]` in the back office, "Pause days" opens a date range picker
   showing the order's delivery days. Staff choose from and to and save. The order's end date moves later by
   the number of delivery days skipped. Removing a pause before it starts gives the days back.
2. **Customer (slice 3).** In the account, each active order shows "Pause or skip days". The same range
   picker lets the customer skip one day or a range. It is allowed only for days after the cutoff: a pause
   cannot start before the earliest date a new order could (14:00 rule, `order_cutoff_hour`). The customer
   sees the new end date before confirming. Staff get the usual Telegram note.
3. **Limits.** Pauses total at most 30 delivery days per order (a setting). A pause never deletes paid days.
   Overlapping pauses merge.

## Data model: migration `NNNN_order_pauses.sql` (additive)

- `public.order_pauses`:
  - Columns: `id uuid pk`, `order_id uuid not null references orders on delete cascade`, `from_date date not
    null`, `to_date date not null check (to_date >= from_date)`, `created_by uuid null` (staff or customer
    user), `source text not null check (source in ('staff','customer'))`, `created_at timestamptz default
    now()`, `cancelled_at timestamptz null`.
  - Index on `(order_id) where cancelled_at is null`.
- `private.order_delivers_on(p_order_id uuid, p_date date) returns boolean`: true when the date is on or
  after the start, is not a weekend for weekdays-only orders, is not inside an active pause, and the delivery
  count up to that date is at most `days`.
- `private.order_day_index_paused(p_order_id, p_date)` and `private.order_end_date_paused(p_order_id)` count
  only non-paused delivery days. The old two functions stay, so nothing breaks mid-deploy.
- Switch `kitchen_orders`, `delivery_orders`, `customers_ending`, `customer_detail`, `my_orders` and the
  reports that compute an end date to the paused versions.
- RLS:
  - Staff who can handle orders read and write everything.
  - A customer can read the pauses of their own orders (`orders.user_id = auth.uid()`).
  - Customers insert only through `pause_my_order(p_number, p_from, p_to)` (SECURITY DEFINER, checks
    ownership, status `active`/`paid`/`confirmed`, cutoff and the 30-day cap) and cancel only future pauses
    through `cancel_my_pause(p_id)`.
- Audit: pauses go into `audit_log` and `order_events` like other order changes.

## Design rules

- The calendar shows only this order's delivery days. Paused days are struck through, and a line says
  "Ends 12 Dec instead of 9 Dec".
- uz, uzc and ru strings. Mobile-first bottom sheet on phones.
- On the home and goal pages, "Already included" goes back to "Pause and move days in your account" once
  slice 3 ships (until then it says "by message before 14:00").

## Slices

1. **Migration and functions.** Table, functions, policies and the switch of the sheets and reports to the
   paused versions. Tested on local Postgres with orders that cross weekends and have overlapping pauses.
   Reviewer: yes.
2. **Staff UI** on the order detail, kitchen sheet and delivery sheet (paused orders drop out on those days).
   Reviewer: yes.
3. **Customer UI** in the account, plus the Telegram note to staff and the "Already included" copy change.
   Reviewer: yes (auth and customer data).

## Risks

- Every report that computes an end date must switch together, or the numbers disagree. The reviewer should
  grep for `order_end_date(` and `order_day_index(` callers.
- Finance: a pause does not change revenue (prepaid). No ledger change.
