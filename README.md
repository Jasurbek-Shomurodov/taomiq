# TAOMIQ — taomiq.uz

Premium daily meal-plan delivery in Tashkent. This folder holds the research and planning documents prepared before the website build (23 Nov 2026).

## The app

One Next.js app serves two sites:

| Site | Production | Development | Code |
|---|---|---|---|
| Client site (Uzbek + Russian) | `taomiq.uz` | `http://localhost:5555` | `src/app/[locale]` |
| Admin (Russian) | `admin.taomiq.uz` | `http://admin.localhost:5555` | `src/app/admin` |

`src/proxy.ts` routes by hostname; the admin is not reachable from the public host.

```bash
npm install
npm run dev -- -p 5555
```

### What works today

- Client: home, program pages with price tables, 30-day menu browser, sitemap, robots, hreflang.
- Admin: login, overview with menu progress, dishes (photo, КБЖУ per 100 g, composition, allergens),
  30-day menu editor per calorie level with live day totals, copy between calorie levels, programs and prices.
- Not built yet: order configurator, Payme/Click checkout, customer account, Telegram bot.

Logo: the approved source is `src/assets/brand/taomiq-logo.jpg`; `node scripts/build-brand-assets.mjs` rebuilds the
favicon, share image and other raster crops from it, and `src/components/Logo.tsx` draws the live logo.

### Supabase

Until the keys are set, the client site shows demonstration data from `src/lib/data/demo.ts` and the admin shows
a "database not connected" page.

1. Create a Supabase project in **Frankfurt (eu-central-1)**.
2. Run the files in `supabase/migrations` in order (SQL editor or CLI). They create the tables, security rules,
   the photo bucket and the three launch programs. (Already applied to the `taomiq` project.)
3. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key.
4. Create the login in Supabase → Authentication → Users, then give it a role — `owner` (everything) or `admin` (dishes and menu only):
   ```sql
   insert into public.staff (user_id, name, role)
   select id, 'Имя', 'admin' from auth.users where email = 'cook@example.com';
   ```

### Vercel

Add both domains (`taomiq.uz`, `admin.taomiq.uz`) to one Vercel project, set the same environment variables,
and pin the function region to Frankfurt (`fra1`).

### Environment variables: one source

Vercel is the single place variables are kept. `.env.local` is a copy of the **Development** set and is
refreshed automatically before every `npm run dev` (`scripts/env-pull.mjs`); run `npm run env:pull` to refresh by hand.
Never edit `.env.local` directly — change the value in Vercel and pull.

One-time setup on a new machine:

```bash
npm i -g vercel
vercel login
vercel link --yes --project taomiq --scope hoggish
```

| Variable | Production | Development |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://taomiq.uz` | `http://localhost:5555` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API keys | same values |
| `SUPABASE_SECRET_KEY` | Supabase secret key | same value (not marked Sensitive, or it cannot be pulled) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_STAFF_CHAT_ID` | order alerts | same values, or leave unset to keep local orders silent |

If the pull fails (offline, not logged in, or Development is missing the Supabase keys) the script leaves
`.env.local` untouched, so local work never breaks. When a Supabase key is rotated, update it in Vercel
(Production and Development), redeploy, and pull.

### Tests

`npm run test:e2e` runs the Playwright smoke suite (`e2e/`) on a phone and a desktop viewport in Chromium. It is
the fourth step of the gate, after lint. First time on a machine: `npx playwright install chromium`.

- It builds and starts its own production copy of the app on port 5599 (`scripts/e2e-server.mjs`), in `.next-e2e`,
  so the `.next` folder of `npm run dev` and `npm run build` is not touched.
- It always runs in **demo mode**: the Supabase and Telegram variables are forced empty, which wins over
  `.env.local`. The first test checks that the admin shows "База данных не подключена" and stops the run otherwise;
  the browser also refuses any request to `*.supabase.co` or `api.telegram.org`.
- The signed-in account checks (`e2e/account-signout.spec.ts`, the `account` projects) need a second build:
  `scripts/e2e-server.mjs --account` builds into `.next-e2e-account` and serves it on port 5598, against a local
  mock of Supabase on port 5595 (`scripts/e2e-mock-supabase.mjs`, a made-up customer from `e2e/account-fixture.json`).
- The ports must be free (it never reuses a running server). Other ports: `E2E_PORT=5600 npm run test:e2e`, and
  `E2E_ACCOUNT_PORT` / `E2E_MOCK_PORT` for the account build.
- After a failure: `npx playwright show-report` (traces of failed tests are kept in `test-results/`).

## Documents

| # | Document | Contents |
|---|---|---|
| 01 | [Brand foundation](docs/01-brand-foundation.md) | Brandbook rules the website must follow: colours, type, voice, programs |
| 02 | [Market research](docs/02-market-research.md) | Tashkent competitors, Russia/Kazakhstan, global leaders, failures, benchmarks |
| 03 | [Product strategy](docs/03-product-strategy.md) | Positioning, launch programs, pricing proposal, service promises |
| 04 | [Website specification](docs/04-website-spec.md) | Site map, home page, order flow, account, content checklist |
| 05 | [Technical architecture](docs/05-technical-architecture.md) | Next.js + Vercel + Supabase, payments, auth, data model, admin |
| 06 | [SEO and marketing](docs/06-seo-marketing.md) | Technical SEO, keyword page map, content, channels, metrics |
| 07 | [Roadmap](docs/07-roadmap.md) | Business prerequisites, build phases, post-launch |
| 08 | [Open questions](docs/08-open-questions.md) | Decisions needed and facts still to verify |

## Five things to know

1. `taomiq.uz` is unregistered today — register it now.
2. No Tashkent competitor has real online checkout or a customer account; the strongest site is foodstar.uz.
3. The premium tier (above ~260,000 UZS/day) has no strong digital player.
4. Payme, Click and SMS contracts need a registered business — this has the longest lead time.
5. The category's biggest players elsewhere (Level Kitchen, Fresh n' Lean, Freshly) failed on retention and logistics; prices and promises must be set from unit economics.
