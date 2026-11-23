# TAOMIQ — taomiq.uz

Premium daily meal-plan delivery in Tashkent. This folder holds the research and planning documents prepared before the website build (23 Nov 2026).

## The app

One Next.js app serves two sites:

| Site | Production | Development | Code |
|---|---|---|---|
| Client site (Uzbek + Russian) | `taomiq.uz` | `http://localhost:3000` | `src/app/[locale]` |
| Admin (Russian) | `admin.taomiq.uz` | `http://admin.localhost:3000` | `src/app/admin` |

`src/proxy.ts` routes by hostname; the admin is not reachable from the public host.

```bash
npm install
npm run dev
```

### What works today

- Client: home, program pages with price tables, 30-day menu browser, sitemap, robots, hreflang.
- Admin: login, overview with menu progress, dishes (photo, КБЖУ per 100 g, composition, allergens),
  30-day menu editor per calorie level with live day totals, copy between calorie levels, programs and prices.
- Not built yet: order configurator, Payme/Click checkout, customer account, Telegram bot.

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
