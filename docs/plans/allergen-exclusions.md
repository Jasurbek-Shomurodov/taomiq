# Plan · Allergen chips at order and an allergen filter on the menu

Approved for planning by Jasurbek on 27 Nov 2026 (round-two research, item 6). Today exclusions are one free-text
field (`orders.exclusions`), and the kitchen has to read it. Dishes already carry `allergens text[]`, but
nothing uses it publicly.

## Goal and user flow

1. **Order form.** Under the ration step, "Anything to leave out?" shows tappable chips: gluten, milk, eggs,
   nuts, peanuts, fish, seafood, sesame, soy and mushrooms. Below them, the existing free-text field becomes
   "Something else" (up to 3 items, as promised). The summary lists the chosen items.
2. **Menu.** The menu page gets an "Allergens" chip row. Choosing one outlines every dish containing it and
   adds a line under the day: "2 dishes contain milk; we replace them for you" (this wording assumes the
   kitchen swaps them, which the owner must confirm).
3. **Kitchen sheet.** The production sheet groups rations by their exclusion set, so the cook sees "BALANCE
   1800 × 4, of them 1 without milk".

## Data model: migration `NNNN_order_exclusion_tags.sql` (additive)

- `orders.exclusion_tags text[] not null default '{}'`. A check limits it to the fixed list, using the same
  keys as `dishes.allergens` (normalise existing dish values to these keys in the same migration only if
  they already match; otherwise leave them for the back office).
- `submit_order`, `staff_create_order` and `staff_edit_order` accept `p_exclusion_tags text[]` and validate
  them against the list (at most 10, no duplicates).
- `kitchen_orders` returns `exclusion_tags`.
- The back-office dish editor shows the same fixed allergen list as checkboxes, so dish data and order data
  share one vocabulary.

## Design rules

- Chips use the existing `Option` radio-card style (multi-select).
- Every allergen name exists in uz, uzc and ru. Names live in one map in `src/lib/allergens.ts`.
- No health claims. One line under the chips says that a kitchen working with these products can't
  guarantee traces are absent.

## Slices

1. **Migration**, the function changes, `src/lib/allergens.ts` and the back-office dish checkboxes.
   Reviewer: yes.
2. **Order form chips** and the summary. Reviewer: yes (order flow).
3. **Menu allergen filter** and kitchen sheet grouping.

## Decision (27 Nov 2026)

The owner left the choice to us ("do as you like"). The rule: **a dish that contains an excluded allergen is
swapped for a dish without it.** That is the safer promise, because an ingredient often can't be taken out of
a prepared dish. The wording lives in one dictionary key per locale (`allergens.swapNote`), so it is easy to
change if the kitchen works differently.
