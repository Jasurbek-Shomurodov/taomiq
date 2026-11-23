# 04 · Website specification

What gets built for taomiq.uz v1. Design follows [01-brand-foundation.md](01-brand-foundation.md); structure follows the patterns in [02-market-research.md](02-market-research.md).

## 1. Principles

1. **Mobile first.** 82% of Uzbek users are mobile-first; every screen is designed at 375 px before desktop.
2. **Three languages, equal quality:** Uzbek in Latin script (default), Uzbek in Cyrillic script and Russian ([plan](plans/third-locale-uzbek-cyrillic.md), 23 Nov 2026). No raw keys, no half-translated pages.
3. **Price and menu are never hidden.**
4. **One primary action per screen:** "Choose plan" / «Выбрать рацион» / "Ratsion tanlash".
5. **Calm premium:** Deep Forest and Ivory surfaces, gold accents, serif headings, real photography, generous spacing. No timers, pop-ups or flashing banners.
6. **Fast:** static pages, optimised images, under 2.5 s to main content on 4G.

## 2. Site map

| Page | Purpose |
|---|---|
| Home | Explain, prove, route to a program |
| Programs (overview + one page per program) | Compare and choose |
| Menu | Full 30-day menu by program and calorie level |
| Calculator | Calories and macros → recommended program |
| Order (configurator + checkout) | Buy |
| Delivery | Zones, windows, map, address check |
| About / Kitchen | Trust: team, chef, nutritionist, production, halal |
| FAQ | Objections |
| Corporate | B2B lead form (phase 2 product, page at launch) |
| Blog | SEO content |
| Account | Manage plan |
| Legal: Public offer, Privacy policy, Refund rules | Required by law (Uzbek version mandatory) |
| Admin | Staff back office |

## 3. Home page, section by section

| # | Section | Content |
|---|---|---|
| 1 | Header | Logo · Programs · Menu · Delivery · About · language switch · phone/Telegram · **Choose plan** |
| 2 | Hero (Deep Forest) | Headline «Умное питание. Каждый день.» · one-line promise (fresh daily, counted, delivered by morning) · goal tabs: Lose weight / Stay balanced / Build muscle · "from 215,000 UZS/day" · primary button |
| 3 | Proof bar | Maps rating and review count · meals delivered · halal · "cooked last night" (only real numbers; hidden until they exist) |
| 4 | How it works | 3 steps: choose program → we cook overnight → at your door by morning |
| 5 | Programs | 3 cards: name, who it is for, calorie levels, price per day, "View menu" |
| 6 | Today's menu | Real dishes for today/tomorrow for the selected program: photo, name, weight, kcal, Б/Ж/У; daily totals; link to full menu |
| 7 | What's included | Swaps, exclusions, pause, 7-day delivery, one price — as a short list |
| 8 | Calculator teaser | "Not sure how many calories?" → calculator |
| 9 | Kitchen and team | Chef and nutritionist with names and photos; production photos; standards |
| 10 | Reviews | Real customer reviews; later, stories with program and duration (no weight-loss promises) |
| 11 | Delivery | Zone map + address check + windows |
| 12 | FAQ | 6–8 questions |
| 13 | Final call to action | Choose plan / Ask a nutritionist in Telegram |
| 14 | Footer | Links, district pages, legal entity details, payment logos, social |

## 4. Order flow

One page, five short steps, live summary always visible (sticky bottom bar on mobile).

| Step | User chooses | Notes |
|---|---|---|
| 1. Program | LIGHT / BALANCE / PROTEIN, then calorie level | Pre-selected if arriving from a program page or the calculator |
| 2. Schedule | Duration (trial 2 / 7 / 14 / 30 days) · every day or weekdays only · start date | Earliest start = next day if before the cutoff |
| 3. Delivery | Address (Yandex suggest + map pin) · entrance/floor/apartment · time window · courier note ("don't call", "leave at door") | Address checked against zone polygon immediately |
| 4. Contact | Phone → OTP code · name · exclusions (up to 3) · promo code | The verified phone becomes the account |
| 5. Payment | Payme · Click (Uzum later) | Redirect → return to success page → Telegram confirmation |

- Total is shown from step 1 and never changes unexpectedly.
- "I'd rather talk to someone" link on every step → Telegram manager (creates a lead with the current selection).
- Abandoned orders are saved; a reminder is sent only with consent.
- Cash on first delivery: **not offered at launch** (proposal) — it keeps the flow manager-free. See open questions.

## 5. Program page

Hero with program name and tag colour → who it is for → calorie level switch → macro targets per day (protein grams prominent for PROTEIN) → 7-day menu preview with photos → price table by duration → what's included → FAQ → button to order with this program pre-selected.

## 6. Menu page

- Filters: program, calorie level, day 1–30 (or calendar week).
- Each day: meals in order with photo, name, weight, kcal, Б/Ж/У; day totals.
- Dish detail: composition, allergens, storage, reheating.
- Allergen filter highlights dishes containing a selected allergen.

## 7. Calculator

Inputs: sex, age, height, weight, activity level, goal. Output: daily calories and Б/Ж/У, the recommended program and level, and a button to order it. Clearly labelled as an estimate, not medical advice.

## 8. Account

| Area | Functions |
|---|---|
| Overview | Active plan, days left, next delivery, "Renew" |
| Calendar | Each delivery day with its menu; **skip** a day, **pause** a range, move a day — until the cutoff; days are not lost |
| Dishes | Swap a dish for an alternative; rate delivered dishes |
| Delivery | Change address, window, courier note |
| Preferences | Exclusions, language, Telegram connection |
| Payments | History and fiscal receipts |
| Referral | Personal code and status |
| Cancel | Self-service cancellation with the refund calculation shown |

## 9. Telegram bot (v1)

- Link account by phone.
- Notifications: payment received, tomorrow's menu and window, courier on the way, plan ending in 3 days.
- Buttons: skip tomorrow, pause, contact support.

## 10. Admin

See section 8 of [05-technical-architecture.md](05-technical-architecture.md): orders and subscriptions, daily production sheet, label export, delivery sheet, menu editor, prices/promos/zones, leads.

## 11. Content needed from the business

| Item | Needed for |
|---|---|
| Vector logo and TQ monogram | Header, favicon, social images |
| Dish photos (all launch dishes) + 10–15 lifestyle/kitchen shots | Home, menu, programs |
| 30-day menu for 6 SKUs with weights, КБЖУ, composition, allergens | Menu, labels |
| Final prices | Programs, order |
| Delivery zones and windows, cutoff time | Order, delivery page |
| Legal entity details, public offer, privacy and refund policy (Uzbek + Russian) | Footer, legal pages, payment onboarding |
| Chef and nutritionist names, photos, short bios | Trust section |
| Texts in Uzbek reviewed by a native editor | All pages |

## 12. Out of scope for v1

Native apps · Telegram Mini App · saved-card auto-renewal · Uzum payments · bonus points · gift certificates · courier mobile app with live tracking · English version. (Uzbek Cyrillic moved into scope on 23 Nov 2026: [plan](plans/third-locale-uzbek-cyrillic.md).)
