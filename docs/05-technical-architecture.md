# 05 · Technical architecture

Stack as requested: **GitHub + Next.js on Vercel + Supabase**. This document adapts that stack to Uzbekistan's payment, legal, language and network constraints. Facts marked ⚠ come from secondary sources and need confirmation (see [08-open-questions.md](08-open-questions.md)).

## 1. Stack summary

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router, TypeScript), Server Components + Server Actions | SEO-critical marketing pages rendered statically; one codebase for site, account and admin |
| UI | Tailwind CSS + shadcn/ui, themed with brand tokens | Fast to build, fully restyled to Forest/Ivory/Gold |
| i18n | `next-intl`, routes `/uz/…` and `/ru/…` | Uzbek is legally required for offer terms; Russian is the main buying language in Tashkent |
| Hosting | Vercel, functions pinned to **`fra1` (Frankfurt)** | No Vercel region in Central Asia; Europe is ~70–90 ms from Tashkent, Mumbai/Dubai are ~210 ms. Default `iad1` (US) must not be used |
| Database | Supabase Postgres in **`eu-central-1` (Frankfurt)**, PostGIS enabled | Same region as functions; Germany is on Uzbekistan's cross-border adequacy list ⚠ |
| Auth | Supabase Auth, phone-first OTP | Email is rarely used for consumer services in Uzbekistan |
| OTP delivery | Telegram Gateway first (~$0.01), **Eskiz.uz** SMS fallback (~95 UZS) via Supabase Send SMS Hook | Supabase's built-in Twilio route costs 15–60× more for Uzbek numbers |
| Storage | Supabase Storage (dish photos), served through `next/image` | |
| Payments | Payme + Click directly at launch; Uzum as third | The two buttons every Uzbek buyer expects |
| Maps | Yandex Geosuggest + map pin at checkout; zones as PostGIS polygons | Best address data in Tashkent; zone logic stays vendor-independent |
| Messaging | Telegram bot (order status, delivery reminders, support hand-off) | ~76% of Uzbek internet users are on Telegram |
| Analytics | Google Analytics 4 + Yandex Metrica + Meta Pixel + Vercel Analytics | Google ≈76% and Yandex ≈22% of search |
| Errors | Sentry | |

## 2. Hosting, latency, data law

- **Data localisation was relaxed in March 2026** ⚠ (law ZRU-1125). In-country storage is now mandatory only for biometric data, genetic data and telecom-subscriber data. Names, phones, addresses and orders may be stored abroad in a country on the Cabinet of Ministers' adequacy list (49 countries, approved 29 Jul 2026; Germany and the USA are named).
- Consequences for us:
  - Supabase Frankfurt + Vercel is workable. **Never collect biometrics** (no face/voice data).
  - Consent checkbox at sign-up and a privacy policy stating that data is stored in the EU.
  - Breach procedure: notify within 24 h, details within 72 h.
  - Keep the schema plain Postgres so PII could be moved to a Tashkent server if rules tighten again.
- **Performance budget:** ~85 ms round trip to Frankfurt. Therefore: marketing and menu pages are static/ISR; no serial DB waterfalls; images in AVIF/WebP; target LCP < 2.5 s on a mid-range Android over 4G (82% of users are mobile-first).
- Use the `taomiq.uz` domain everywhere; never show `*.vercel.app` to users. Test from Uztelecom, Beeline, Ucell and Mobiuz before launch.

## 3. Domain

- `.uz` domains are sold only through cctld.uz accredited registrars (Ahost/Tomas, Sarkor, Airnet, Uzbektelecom and others). Vercel cannot register `.uz`.
- Point it to Vercel with an A record (apex) + CNAME (`www`), or delegate NS to Vercel.
- Whether `taomiq.uz` is still free is being checked in the Uzbekistan competitor research — see [02-market-research.md](02-market-research.md).

## 4. Application structure

```
app/
  [locale]/                      uz | ru
    (marketing)/
      page.tsx                   Home
      programs/[slug]/           light | balance | protein | …
      menu/                      Weekly menu by program and kcal
      calculator/                Calorie & macro calculator
      delivery/                  Zones, windows, map
      about/  faq/  corporate/
      blog/[slug]/
      legal/offer  legal/privacy
    (shop)/
      order/                     Configurator → checkout
      order/success  order/failed
    (account)/
      account/                   Active plan, calendar, pause, addresses, receipts
  admin/                         Staff back office (ru only)
  api/
    payments/payme/              JSON-RPC webhook
    payments/click/prepare|complete
    auth/sms-hook/               Supabase Send SMS Hook → Telegram Gateway / Eskiz
    telegram/webhook/
    cron/generate-deliveries
lib/        payments/, pricing/, delivery/, i18n/, supabase/
supabase/   migrations/, seed.sql
```

## 5. Data model (core tables)

| Table | Purpose | Key columns |
|---|---|---|
| `profiles` | Customer | `id` (auth uid), `phone`, `name`, `locale`, `telegram_id`, `referral_code` |
| `addresses` | Delivery addresses | `profile_id`, `text`, `entrance/floor/apt`, `geo` (PostGIS point), `zone_id`, `comment` |
| `delivery_zones` | Polygons + rules | `name`, `polygon`, `fee`, `windows[]`, `active` |
| `programs` | LIGHT, BALANCE… | `slug`, `name_uz/ru`, `tagline_uz/ru`, `tag_color`, `active`, `sort` |
| `program_variants` | A kcal level in a program | `program_id`, `kcal`, `meals_per_day`, `protein/fat/carb` targets |
| `price_rules` | Price per day by duration | `variant_id`, `days` (1/7/14/30), `price_per_day` (UZS), `ikpu_code`, `package_code`, `vat_rate` |
| `dishes` | Dish catalogue | `name_uz/ru`, `photo`, `weight_g`, `kcal`, `p/f/c`, `ingredients_uz/ru`, `allergens[]`, `verified` |
| `menu_days` | 30-day rotating menu | `variant_id`, `cycle_day` (1–30), `slot` (breakfast…), `dish_id` |
| `subscriptions` | A purchased plan | `profile_id`, `variant_id`, `days_total`, `days_left`, `weekdays[]`, `start_date`, `status`, `address_id`, `window`, `exclusions[]` |
| `deliveries` | One row per delivery day | `subscription_id`, `date`, `status`, `window`, `address_snapshot`, `courier_id` |
| `orders` | A checkout | `profile_id`, `subscription_id`, `amount`, `promo_id`, `status` |
| `payments` | Provider transactions | `order_id`, `provider`, `provider_tx_id`, `amount_tiyin`, `state`, `fiscal_receipt_url`, raw payload |
| `promo_codes`, `referrals` | Discounts | |
| `leads` | Callback / consultation / B2B requests | `phone`, `source`, `utm_*`, `status` |
| `reviews`, `dish_ratings` | Social proof and menu feedback | |
| `staff` | Admin roles | `role`: owner, manager, kitchen, courier |

Rules:
- **Row Level Security on every table.** Customers see only their rows; staff access through a `staff` role check; payment webhooks use the service role on the server only.
- Money is stored as integers (UZS; tiyin for Payme).
- `deliveries` is the operational source of truth: pause, skip and move-a-day are edits to these rows, and the kitchen/courier sheets are queries over them.

## 6. Payments

Sold as **prepaid packages** (trial, 7, 14, 30 days) — the model every local competitor uses. Auto-renewal with saved cards comes later.

```
Checkout → order(pending) → redirect to Payme / Click
        → provider calls our webhook → payment state machine
        → order(paid) → subscription(active) → deliveries generated
        → Telegram + on-site confirmation, fiscal receipt link stored
```

- **Payme:** redirect checkout plus Merchant API webhook (JSON-RPC 2.0: `CheckPerformTransaction`, `CreateTransaction`, `PerformTransaction`, `CancelTransaction`, `CheckTransaction`, `GetStatement`). Always answer HTTP 200; amounts in tiyin. Commission ≈2% ⚠.
- **Click:** SHOP API `prepare` and `complete` callbacks, MD5-signed. Commission 1.5–2.5%.
- **Uzum Bank:** phase 2; onboarding through a manager, rates not published.
- **Alternative:** Multicard (one contract, one invoice API) if we want a single integration first.
- One internal `PaymentProvider` interface; every webhook is idempotent and logged raw.
- **Fiscal receipts:** each plan carries an IKPU code, package code and VAT rate; item details are passed to the provider, which fiscalises as commissioner (registered in my.soliq.uz). The receipt link is shown in the customer account — the e-commerce law requires sending it automatically.
- **Merchant accounts need a registered business** (IP or OOO), bank account, IKPU codes. This has the longest lead time of anything in the project — start it first.

## 7. Auth and Telegram

- Sign-in by phone number + 6-digit code. Supabase generates the OTP; our Send SMS Hook delivers it through Telegram Gateway, falling back to Eskiz SMS. Eskiz requires a contract with a local legal entity and pre-approved message templates (1–2 days moderation).
- Checkout does not require an account up front: the phone verified during checkout becomes the account.
- Telegram bot: order confirmation, "your delivery is tomorrow 7–9", pause/skip buttons, support hand-off to a manager. A Telegram Mini App reusing the same order flow is a strong phase-2 channel.

## 8. Admin back office (`/admin`)

The site replaces the Instagram-DM-and-spreadsheet workflow competitors run on. Minimum for launch:

1. **Orders & subscriptions** — list, status, manual create (for phone/Instagram orders), pause, extend, refund note.
2. **Daily production sheet** — for date D: count of each dish by program and kcal; printable.
3. **Label data export** — dish, weight, КБЖУ, composition, allergens, date (matches the brandbook label).
4. **Delivery sheet** — deliveries by zone and window, with address, phone, comment; courier marks delivered.
5. **Menu editor** — dishes and the 30-day cycle per variant.
6. **Prices, promo codes, zones.**
7. **Leads inbox** — callbacks, consultations, corporate requests.

## 9. Environments and workflow

| Environment | Vercel | Supabase | Payments |
|---|---|---|---|
| Local | `next dev` | Supabase CLI local stack | Mock provider |
| Preview (every PR) | Preview deployment | Staging project | Payme/Click sandbox |
| Production (`main`) | taomiq.uz | Production project (Frankfurt) | Live |

- GitHub repo `taomiq-web` (private). Branch → PR → preview URL → merge to `main` deploys production.
- Database changes only through versioned migrations in `supabase/migrations`.
- CI on each PR: typecheck, lint, unit tests for pricing and payment state machine, Playwright smoke test of the order flow.
- Secrets live in Vercel environment variables; nothing sensitive in the repo.

## 10. Security checklist

- RLS on all tables; service-role key only in server code.
- Webhook verification: Payme Basic auth + IP allowlist, Click signature check.
- Rate limits on OTP requests (per phone and per IP); bot protection on public forms.
- Admin behind staff role + separate login; audit log on price, refund and subscription edits.
- Daily database backups (Supabase PITR on the paid plan).

## 11. Estimated running costs (monthly, launch scale)

| Item | Cost |
|---|---|
| Vercel Pro | ~$20 |
| Supabase Pro | ~$25 |
| `.uz` domain | a few dollars a year via a local registrar ⚠ |
| OTP (Telegram Gateway + SMS) | ~$10–30 at a few thousand logins |
| Sentry, analytics | free tiers |
| Payment commission | ~2–2.5% of revenue |
| Yandex Maps | free tier for the public checkout; paid licence only if used inside the closed admin ⚠ |
