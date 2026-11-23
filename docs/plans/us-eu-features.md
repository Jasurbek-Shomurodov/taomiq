# Plan · Features to add, from US and EU leaders

Researched 23 Nov 2026. Extends [02-market-research.md](../02-market-research.md) §3, which already covers the Gulf, Russia and one-line notes on the US/UK.

## How each company was read

| Read live | Secondary sources only | Could not be read |
|---|---|---|
| CookUnity, Trifecta, Methodology, Hungryroot, Tovala, Snap Kitchen (US) · Frive, Field Doctor, Gousto (UK) · Wetaca (ES) · Löwenanteil, Every. (DE) | Factor (App Store, reviews) · Prep Kitchen (Trustpilot) · Fresh Fitness Food (press) | Territory, Mindful Chef, Seazon |

Mobile layout was observed at 375 px on Frive and Field Doctor only. Motion itself could not be observed on any site.

## What they do that TAOMIQ does not

**Conversion**
- **Finder quiz fronted by a named dietitian** (Field Doctor): photo and speech bubble, one question per screen, large tap rows, "Continue" pinned to the bottom.
- **Comparison table.** Frive compares itself with unnamed "Competitor A/B"; Gousto names rivals; Hungryroot compares *categories* (meal services, takeout, grocery). The category version fits Tashkent: TAOMIQ vs cooking at home vs restaurant delivery vs ordinary rations.
- **Trial with no subscription** (Löwenanteil "Probierpaket", Field Doctor one-off box).
- **Messenger community with a first-order benefit** (Löwenanteil: WhatsApp 10 % vs newsletter 5 %) — the Telegram-channel equivalent.
- **Price honesty in the hero** (Gousto footnotes exactly which box the "from" price refers to).
- **Outcome statistics with a visible footnote** (Hungryroot states survey size and date).
- Gift cards (six of the brands), referral pages, segment discounts (students, health staff).
- No meal brand read live states a satisfaction guarantee — a "first day refunded if you don't like it" promise would stand out.

**Menu**
- **Chips and badges on dish cards** (Frive): kcal chip, protein/carbs/fibre chips, "Top Rated", "New", "High Protein", "Under 500 kcal"; an (i) button opens the dish detail without leaving the list.
- **Goal chips as navigation** (Field Doctor: seven "Meals for…" chips, each a landing page).
- Editorial badges (Every.: "Chef's Favorite"), paid protein boost and add-ons (Factor), automatic next-week menu seeded from the first order with a stated edit cutoff (Wetaca).

**Retention**
- **Rate-your-meals loop** (Factor, CookUnity) whose public output is the "Top Rated" badge (Frive).
- **Pause with a return date and a stated cutoff, no reason asked** (Wetaca).
- In-app delivery tracking (Factor); dietitian session included (Factor, Fresh Fitness Food).

**Trust**
- Evidence block with cited research and stat tiles (Methodology); named expert on screen (Field Doctor); chef profile pages (CookUnity); named supplier cards (Gousto); reusable-packaging collection (Methodology); review score with count near the top (most).

**Search structure** — the page types that rank for them:

| Page type | Example pattern |
|---|---|
| Diet / goal landing | `/diets/{slug}`, `/range/{slug}`, `/peak-high-protein-meal-delivery` |
| City / area | `/us/{city}`, `/delivery-map` |
| Dish | `/meals/{slug}` |
| Tools | `/macro-calculator`, `/tdee-calculator`, `/protein-calculator`, `/bmi-calculator`, `/water-intake-calculator` |
| Audience | `/blp/{athletes,new-parents,seniors}` |
| Comparison | `/how-we-compare` |
| Content hubs and proof | `/blog`, `/guides`, `/reviews`, `/customer-stories` |

CookUnity's diet page is a reusable template: h1, intro, ~10 dish cards, steps, chefs, reviews, 8 FAQ questions, and a footer block cross-linking every other diet, cuisine and city page.

## Ranked list for TAOMIQ

Items that work with today's request form + Telegram rank first.

| # | Feature | Effort | Needs payments / account | Impact | Lives in plan |
|---|---|---|---|---|---|
| 1 | Sticky bottom order bar with "from X so'm/day" | S | No | High conversion | [motion-mobile-ux](motion-mobile-ux.md) slice 2 |
| 2 | Goal landing pages (weight loss, high protein, balanced, halal) uz + ru, with FAQ schema | M | No | High SEO | [seo](seo.md) |
| 3 | Dish badges + macro chips; dish detail in a bottom sheet | S | No | Medium–high conversion | this plan, slice A |
| 4 | Program-finder quiz with a named nutritionist → pre-filled request form | M | No | High conversion | this plan, slice B |
| 5 | Category comparison table | S | No | Medium conversion, trust | this plan, slice C |
| 6 | District delivery pages with real windows | M | No | High local SEO | [seo](seo.md) |
| 7 | Calculator suite (protein, TDEE, BMI, water), each ending in a recommended program | S–M | No | Medium SEO, leads | [seo](seo.md) |
| 8 | No-commitment trial with a stated refund promise | S | No (manager) | High conversion | this plan, slice C |
| 9 | Reviews block with Google / Yandex Maps score + reviews page | S | No | High trust | this plan, slice D — only when real reviews exist |
| 10 | Evidence and sourcing block: stat tiles, suppliers, kitchen/chef page, halal certificate | M | No | Medium–high trust | this plan, slice D |
| 11 | Telegram channel join with first-order benefit; referral by promo code in the form | S | No | Medium acquisition | this plan, slice E |
| 12 | Daily "rate today's meals" in the Telegram bot → "Top Rated" badges | M | No (bot, keyed to phone) | High retention | later |
| 13 | Pause / skip request with cutoff and return date via the bot | M | Not at first | High retention | later |
| 14 | Gift certificates issued by the manager | S | No | Low–medium | later |
| 15 | Account: favourites, exclusions, automatic menu, courier tracking, loyalty | L | Yes | High | ordering phase |

## Does not fit Uzbekistan now

- Auto-renewing weekly card subscriptions — sell prepaid periods (already decided in [03-product-strategy.md](../03-product-strategy.md) §6).
- National shipping, frozen or shelf-stable formats — contradicts fresh daily.
- GLP-1 ranges, insurance / health-payer programmes, condition-specific medical ranges.
- Trustpilot — use Google and Yandex Maps.
- Chef marketplace, smart oven, own tracking app with barcode scanning.

## Slices (this plan)

Each is independent and needs no payments or account.

**A. Dish cards: chips, badges, detail sheet (S–M).** `MenuDay.tsx` cards get a kcal chip and protein/fat/carb chips; badges computed from data ("High protein" ≥ a threshold per meal, "Under N kcal"), no editorial badges until ratings exist. Tapping a card opens a bottom sheet with composition, allergens, storage and reheating (spec §6). Check which of these fields the `dishes` table already holds before building; a missing field means an additive migration.

**B. Program finder quiz (M).** New `/[locale]/quiz`: 4–5 one-question screens (goal, activity, meals per day, exclusions, schedule), bottom-pinned Continue, progress bar, result = program + calorie level + price, button to `/order` pre-filled. Reuses `src/lib/calculator.ts`. The nutritionist's face on step one waits for a real named person.

**C. Comparison table and trial promise (S).** Home section "TAOMIQ vs home cooking vs restaurant delivery vs ordinary rations" (time per day, cost per day, macros counted, variety, fresh daily). Trial block states the rule in one sentence.

**D. Trust blocks (M).** Stat tiles, kitchen/chef page, suppliers, halal certificate, reviews. Blocked on real content.

**E. Telegram join and promo code field (S).** Channel join block; `promo_code` on the request form and in the manager's Telegram alert (additive column on `order_requests`).

## Open questions (owner)

1. **Trial and refund promise** — is "2 trial days, first day refunded if you don't like it" something the business will honour? (Slice C)
2. **Comparison numbers** — the cost of home cooking and restaurant delivery per day must be real, sourced figures.
3. **Named nutritionist and chef**, photos, halal certificate, suppliers, and any real statistics (Slices B, D). Nothing is shown until it exists.
4. **Telegram first-order benefit and referral reward** — what is offered? The brandbook rules out loud discounts.
5. **Reviews** — are there Google / Yandex Maps listings yet?
