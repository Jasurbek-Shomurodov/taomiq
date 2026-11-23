# Plan · Order requests (soft-launch ordering)

Status: approved for build, 23 Nov 2026. Follows [04-website-spec.md](../04-website-spec.md) §4 and the "soft launch" note in [07-roadmap.md](../07-roadmap.md).

## Goal

A visitor can configure a plan and place an order on taomiq.uz today, without waiting for Payme/Click contracts or SMS login (both need the legal entity). The order lands in the admin, the owner confirms it by phone/Telegram and takes payment manually. When payments are connected later, the same `orders` table gains a payment step; nothing here is thrown away.

Out of scope: online payment, phone OTP, customer account, deliveries table, zones on a map, promo codes.

## User flow

1. Any "Choose plan" button → `/{locale}/order` (optionally `?program=balance&kcal=1800`, used by program pages and the calculator).
2. One page, three blocks, live summary (sticky bottom bar on mobile, side card ≥ md):
   - **Plan** — program → calorie level → duration (from `durations`; trial marked) → every day / weekdays only → start date.
   - **Delivery** — address (free text, required), 2-hour window (from settings), courier comment.
   - **Contact** — name, phone (`+998` prefix fixed, 9 digits), exclusions (free text, optional), consent checkbox linking to the privacy page.
3. Submit → server action → order saved → redirect to `/{locale}/order/success?n=<number>`: order number, "we will contact you within working hours to confirm", Telegram button.
4. Errors stay on the page next to the field; a general failure shows a message plus the Telegram link. Nothing typed is lost.

## Architecture

| Piece | Where |
|---|---|
| Order page (server component: loads programs, durations, settings) | `src/app/[locale]/order/page.tsx` |
| Configurator (client component, `useActionState`) | `src/app/[locale]/order/OrderForm.tsx` |
| Success page (noindex) | `src/app/[locale]/order/success/page.tsx` |
| Server action `submitOrder` | `src/lib/order/actions.ts` |
| Shared validation + earliest-start-date logic (used by form and action) | `src/lib/order/rules.ts` |
| Settings reader (`delivery_windows`, `order_cutoff_hour`), cached with `CATALOG_TAG` | `src/lib/data/catalog.ts` |
| Privacy page (uz/ru) | `src/app/[locale]/privacy/page.tsx` |
| Admin orders (slice 2) | `src/app/admin/(panel)/orders/…`, `src/lib/admin/actions.ts`, `queries.ts` |

- State lives in the form (client) until submit; the database is the only store after.
- The server action uses the **anon** public client and calls the `submit_order` RPC. There is no service-role key in this app and none is added.
- **The price is never taken from the client.** The RPC computes it from `program_variants.price_per_day` and `durations.markup_pct` with the same rule as `pricePerDay()` in `src/lib/data/types.ts` (round to nearest 1,000 UZS). The form shows the same figure for display only.
- Demo mode (Supabase env not set): the form renders from demo data; submit returns a friendly "ordering opens soon, write to us in Telegram" state. No crash.
- The order page reads `searchParams`, so follow this Next.js version's rules for dynamic APIs and Cache Components (see `node_modules/next/dist/docs/`); keep catalogue reads cached and put the dynamic part behind `<Suspense>` if required.

## Data model — migration `0004_orders.sql` (additive only)

```
public.orders
  id              uuid pk default gen_random_uuid()
  number          bigint generated always as identity (start with 1001) unique
  status          text not null default 'new'
                  check in ('new','confirmed','paid','active','completed','cancelled')
  variant_id      uuid not null references program_variants(id) on delete restrict
  program_name    text not null      -- snapshot
  kcal            int  not null      -- snapshot
  days            int  not null      -- delivered days
  weekdays_only   boolean not null default false
  start_date      date not null
  price_per_day   int  not null      -- UZS, snapshot
  total           int  not null      -- UZS = price_per_day * days
  customer_name   text not null
  phone           text not null check (phone ~ '^\+998[0-9]{9}$')
  address         text not null
  delivery_window text not null
  comment         text not null default ''
  exclusions      text not null default ''
  locale          text not null default 'uz' check in ('uz','ru')
  source          jsonb not null default '{}'   -- utm_* and referrer, whitelisted keys only
  staff_note      text not null default ''
  consent_at      timestamptz not null default now()
  created_at      timestamptz not null default now()
  updated_at      timestamptz not null default now()
```

Indexes: `(status, created_at desc)`, `(phone, created_at desc)`, `(variant_id)`.

RLS: enabled. **No anon or customer policies at all.** `select` and `update` for `authenticated` where `private.is_owner()`. No delete policy. The `admin` role (cooks) cannot see orders — they contain personal data.

Settings rows (insert, `on conflict do nothing`):
- `delivery_windows` = `["06:00–08:00","07:00–09:00","08:00–10:00"]`
- `order_cutoff_hour` = `14`

Function `public.submit_order(p_variant_id uuid, p_days int, p_weekdays_only boolean, p_start_date date, p_name text, p_phone text, p_address text, p_window text, p_comment text, p_exclusions text, p_locale text, p_source jsonb) returns bigint` (the order number):
- `security definer`, `set search_path = ''`, `revoke all … from public`, `grant execute … to anon, authenticated`.
- Raises exceptions with stable codes in the message (`invalid_variant`, `invalid_days`, `invalid_date`, `invalid_phone`, `invalid_name`, `invalid_address`, `invalid_window`, `too_long`, `rate_limited`, `busy`) that the server action maps to localized messages.
- Checks: variant and its program are active; `p_days` exists in `durations`; phone matches the regex; trimmed name 2–80 chars; address 5–300; comment and exclusions ≤ 500; window is one of `settings.delivery_windows`; locale uz/ru; `p_source` reduced to keys `utm_source, utm_medium, utm_campaign, utm_content, utm_term, ref`, each value text ≤ 100.
- Start date, in `Asia/Tashkent`: earliest = tomorrow if the current hour < `order_cutoff_hour`, otherwise the day after tomorrow; latest = today + 60 days.
- Abuse limits: at most 3 orders with status `new` per phone in 24 h (`rate_limited`); at most 60 orders in total in the last hour (`busy`).
- Inserts with snapshots and computed price; returns `number`.

`updated_at` is set by the admin action, not a trigger.

### Revision after review (23 Nov 2026) — supersedes the text above where they differ

- `submit_order` is **not** callable with the public key: `revoke execute … from public, anon, authenticated`; `grant execute … to service_role` only. Otherwise anyone can call the RPC directly, skip the form and flood the table.
- The server action calls it with a server-only Supabase client built from `SUPABASE_SECRET_KEY` (no `NEXT_PUBLIC_` prefix; `import "server-only"`; added empty to `.env.example`). This is the one place the app uses a secret key. If the key is not set, submit behaves like demo mode ("ordering opens soon, write to us in Telegram").
- The global 60-per-hour cap is removed. Added instead: `orders.ip_hash text not null default ''`, index `(ip_hash, created_at desc)`, parameter `p_ip_hash`, limit 10 orders per non-empty `ip_hash` per hour (`rate_limited`). The action derives it as SHA-256 of the first `x-forwarded-for` address plus the secret key as salt; the raw IP is never stored. The privacy page mentions that a technical fingerprint of the connection is kept to prevent abuse.
- `updated_at` is maintained by a `before update` trigger.
- The action never throws: catalogue/settings read failures return the general "failed" state; `redirect()` stays outside the try.
- On an `invalid_date` response the action returns a fresh earliest date and the form moves the selection to it and re-renders the chips.
- Order rules are enforced in the database, not only in the admin action: `authenticated` gets `select` plus `update (status, staff_note)` only (no table-wide update), and a `before update` trigger `private.check_order_status()` rejects any status change other than the next step (new → confirmed → paid → active → completed) or `cancelled` from new/confirmed/paid/active. It mirrors `canMove()` in `src/lib/admin/orders.ts`.

## Design rules

- Brand tokens and classes already in `src/app/globals.css` (`btn`, `btn-gold`, `btn-forest`, `field`, `label`, `container-page`; forest / ivory / gold; serif headings). No new UI library.
- Mobile first at 375 px. Options are large tappable cards/chips, not selects. The sticky summary bar shows program · kcal · days · total and the submit button.
- Money: `215 000 soʻm` / `215 000 сум` formatting already used on program pages — reuse the helper, or extract one if it is inline.
- Every string in both `src/i18n/uz.ts` and `src/i18n/ru.ts`; no hard-coded text. Admin stays Russian only.
- States: pending (button disabled with progress text), field errors, general error with Telegram fallback, demo mode, success.
- Accessibility: real `<label>`s, `fieldset/legend` for option groups, `aria-invalid`, focus moves to the first error.
- Light bot protection in the action: hidden honeypot field; reject if filled. No CAPTCHA.
- Order, success and privacy pages: order and success are `noindex`; privacy is indexable and in the sitemap.

## Slices

1. **Customer order flow.** Migration `0004_orders.sql`; settings reader; `rules.ts`; order page + form + success page; server action; privacy page (plain, factual: what is collected — name, phone, address, order contents; why; stored on Supabase servers in Frankfurt, Germany; who to contact to delete it; no biometrics); footer link to privacy; program pages and calculator-style deep links (`?program=&kcal=`) preselect; uz/ru strings. Leaves `main` working: orders are stored and readable in the Supabase table editor until slice 2.
2. **Admin orders.** `/orders` list with status tabs and counts, newest first, pagination by 50; `/orders/[id]` detail with tap-to-call phone, status change buttons (new → confirmed → paid → active → completed; cancel from any open state), staff note; "new orders" card on the overview; nav item shown to the owner only; all gated by `requireOwner()`. Optional Telegram alert to staff on each new order, sent from the server action with `after()`, only when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_STAFF_CHAT_ID` are set (add both, empty, to `.env.example`); a failed alert never fails the order.
3. **Calculator, delivery page and structured data.** `/{locale}/calculator` (Mifflin-St Jeor: sex, age, height, weight, activity, goal → kcal and Б/Ж/У → nearest program level → button to `/order?program=&kcal=`; labelled as an estimate, not medical advice). `/{locale}/delivery` (windows and cutoff from settings, "inside the Tashkent ring road" text, how the handover works). JSON-LD: `Organization` + `WebSite` in the locale layout, `FAQPage` on the home FAQ, `Product`/`Offer` on program pages. Header/footer links and sitemap entries for the new pages.

## Risks and open questions

- **Unverified phones.** Without OTP anyone can submit any number. Mitigated by the rate limits and by the owner calling to confirm; replaced by OTP in the payments phase.
- **Prices, windows, cutoff and zone are still proposals** (docs/08 #4–6). They are data (`program_variants`, `settings`), editable without a deploy; windows/cutoff have no admin screen yet — change them in the `settings` table.
- **Privacy text and public offer need a lawyer's review** (docs/08 B). The page states only facts about what the form collects. The public offer is not written here.
- **Cooks cannot see orders.** If a manager role is needed, add it as a third staff role later.
- Weekdays-only: `days` counts delivered days; the end date is not stored (derived when deliveries are generated in a later phase).
