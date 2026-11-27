# Plan · Saved delivery details and "Repeat last order"

Approved for planning by Jasurbek on 27 Nov 2026 (round-two research, item 5). Signed-in customers get their
name and phone prefilled, but they type the address, window, courier note and exclusions again on every
order. Renewal is the main retention moment for prepaid plans, so it should take one tap.

## Goal and user flow

1. **Saving.** A signed-in customer places an order. A checkbox under the address, "Save for next time",
   is on by default. When it is on, the address, delivery window and courier note are saved to their
   profile.
2. **Prefill.** The next time they open `/order` signed in, those fields are prefilled. They can change
   them, and a "Clear" link empties them.
3. **Repeat last order.** The account page shows "Repeat last order" on the newest order. It opens
   `/order?repeat=<number>` with that order's program, level, duration, weekdays-only choice, window, address,
   courier note and exclusions filled in. The start date is set to the earliest allowed date. The customer
   checks and submits as usual. The server re-prices, so a price change is always respected.
4. **Signed-out visitors:** no change.

## Data model: migration `NNNN_profile_delivery.sql` (additive)

- `profiles` gains `address text`, `delivery_window text` and `courier_note text`, all nullable, each with a
  length check matching `submit_order` (address 5–300, note ≤ 500).
- `submit_order` gains `p_save_delivery boolean default false`. When it is true and `p_user_id` is set, it
  updates the caller's own profile in the same transaction.
- `my_order_for_repeat(p_number bigint)` (SECURITY DEFINER, `auth.uid()` must own the order) returns
  variant_id, days, weekdays_only, address, delivery_window, comment and exclusions. It never returns another
  customer's order.
- RLS on profiles is unchanged: the customer reads and updates only their own row.

## Design rules

- The account page gets a "Delivery details" card with the saved address and window, editable, plus a
  "Remove" action that clears them.
- The privacy page (uz, uzc, ru) adds one line saying the delivery address is saved to the account when the
  customer chooses, and how to remove it.
- `data-ph-mask` on every new field that shows an address (analytics masking).

## Slices

1. **Migration**, the `submit_order` change, the repeat function and the privacy text. Reviewer: yes
   (personal data).
2. **Order form prefill**, the "Save for next time" checkbox and `?repeat=`. Reviewer: yes.
3. **Account card** with "Repeat last order" and editable delivery details. Reviewer: yes.

## Risks

- An address is personal data. Keep it only on the customer's own profile, and never in URLs (`?repeat=`
  carries the order number only, and the server reads the rest).
- A deleted or inactive variant in a repeated order: fall back to the same program's nearest level and say
  so.
