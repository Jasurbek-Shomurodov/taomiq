# Research · Improving the public site (27 Nov 2026)

Research only, nothing built. I reviewed `src/app/[locale]` and walked taomiq.uz as a visitor at 375 px in
uz and ru, then checked production data (read only). I compared the site with the competitors in
`docs/02-market-research.md` and `docs/plans/us-eu-features.md`. The body goal calculator is out of scope
because another thread is building it.

## What the live site shows today

- The site is fast and well built: three locales, a three-step order form on phones, a sticky order bar,
  goal pages, calculators, a quiz, accounts and Turnstile. Server response time was about 180 ms.
- **There is almost no product on it.** Production has 1 dish, 0 menu items, 0 dish photos and 0 program
  photos. `/menu` and the home "Сегодня в меню" both say the menu is still being prepared, on every day of
  every program. The page headline right above that says «Реальное меню на 30 дней. Вы видите его до
  оплаты.» No page shows a single photo.
- There is no phone number, no legal entity and no reviews. The footer says the public offer will be
  published before launch.
- The order form defaults to **7 days**, and the bar shows **1 967 000 soʻm** before the visitor has chosen
  anything. The home page's last call to action says "start with two trial days".
- Telegram only appears in the order form after an error. The "I'd rather talk to someone" link on every step
  (spec §4) is missing.
- The address is one free-text box. There is no map pin, location share or zone check (spec §4).
- The success page says "we'll contact you in working hours" but gives no hours, no time estimate and no link
  to a bot.

## Prioritised list

Effort: S is up to a day, M is 2 to 4 days, L is a week or more. ⚠ means the owner decides first (design,
data model or pricing).

| # | Improvement | Why | Impact | Effort | Code or owner |
|---|---|---|---|---|---|
| 1 | **Fill the 30-day menu and shoot the dishes and programs.** Load the menu in the admin and upload program cover photos (the upload already exists) | "Transparent menu" is the main pillar, and today it shows an empty box. Every leader leads with real dishes and photos | Very high | Owner content; no code | Owner and kitchen |
| 2 | **Honest empty states until then.** Hide "Today's menu" and the "real menu before payment" claim while the cycle is empty, or show one complete sample day marked as a sample | It stops the site contradicting itself next to the call to action | High | S | Code |
| 3 | **Visible contact and a human fallback.** A tap-to-call phone and Telegram in the header or menu and on every order step ("Talk to a person"), with the selection prefilled in the Telegram message. Add working hours on the success page | Every Tashkent player is manager-led and buyers expect a person. A missing phone number reads as risk for a 2–8 million soʻm purchase | High | S | Code, plus the owner's phone and hours |
| 4 | ⚠ **Order defaults and price framing.** Start on the 2-day trial when the visitor comes from a "try" link. Show the per-day price (and per meal) large in the bar with the total smaller. Shorten the bar's payment note to one line | A 1.97M figure on first view is sticker shock. The trial is the stated low-risk entry point | High | S | Code. It changes the default plan, so it is the owner's call |
| 5 | **Trust blocks once real.** Chef and nutritionist with names and photos, a kitchen photo or video, the halal certificate, legal entity details, and the public offer and refund rule published | Spec home sections 9–10 and the footer. "Refunds that never arrive" is a top complaint in the market | High | M | Owner content; code mostly planned (`us-eu-features` slice D, `kitchen-video`, `findability` slice 3) |
| 6 | **Telegram bot after ordering.** On the success page, a "Get confirmation in Telegram" deep link (`t.me/<bot>?start=<order>`) that links the order and sends confirmation, a delivery-tomorrow message and a plan-ending message with a renewal link | It cuts manager calls and is the cheapest retention lever. Already listed in `findability-and-growth` §7 | High | M | Code and bot setup |
| 7 | ⚠ **Address you can trust.** A "Share my location" button (browser geolocation saved as a pin) next to the landmark box, then a Yandex suggest and zone check later | Uzbek addresses run on landmarks, and a pin saves the courier call. This needs lat/lng columns on orders | Medium–high | S for the pin, M for the zone check | Code plus a migration |
| 8 | **Resume an unfinished order.** Keep the step-1 and step-2 choices (not personal details) in `localStorage` and offer "continue your order" | Most visitors come from Instagram and Telegram and switch apps mid-flow | Medium | S | Code |
| 9 | **Test in the Instagram and Telegram in-app browsers on real phones** (iOS Safari, Android Chrome, Uzbek 4G). This is still open in `motion-mobile-ux` | Most traffic will arrive there, and view transitions and sticky bars break most often in those browsers | Medium | S | Operator or owner |
| 10 | **Native-speaker pass on uz and uzc copy.** This is still open in `seo` | Competitors lose trust with bad Uzbek. Correct Uzbek is a pillar | Medium | S–M | Owner (an editor) |
| 11 | ⚠ **Online payment (Payme or Click), then installments.** A 30-day plan costs 6.4–10.2M soʻm. Uzum Nasiya or Alif Nasiya, or weekly billing like the Russian leaders, makes long plans affordable | No local player pays online, so this is the biggest differentiator in the docs. It is blocked on the legal entity | Very high once unblocked | L | Pricing and contracts, owner first |
| 12 | **Off-site proof.** Google and Yandex Maps listings and review collection, then a review score near the hero (`findability` slices 0–1) | It is the proof bar in spec §3. Hide it until there are real numbers | High over time | Owner | Owner |

## Order I'd do it in

1. Items 2, 3 and 8 (code only, no owner decision, about 2 days in total) while the owner works on item 1.
2. Item 4 once the owner agrees to the default.
3. Item 6, then item 7 (it needs a migration and the owner's OK).
4. Items 5, 11 and 12 as their content and contracts arrive.

## Already planned, not re-proposed

Sticky bar, goal pages, calculators, quiz, dish sheets, comparison table, trial refund promise, referral,
the dish, district and content pages, PostHog funnel, Turnstile, account orders, kitchen video, Telegram Mini
App and auto-renewal. See `us-eu-features`, `findability-and-growth`, `seo`, `kitchen-video` and
`docs/07-roadmap.md`.
