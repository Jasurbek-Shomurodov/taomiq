# Plan · SEO

Decisions already made are in [06-seo-marketing.md](../06-seo-marketing.md) §2–3. This plan is the gap between that document and the code and live site as audited on 23 Nov 2026, split into shippable slices.

## Goal

Every public page is correctly indexable in Uzbek and Russian, previews well when shared in Telegram and Instagram, targets the queries in the page map, and the site grows the page types that rank for US/EU leaders (goal landings, tools, district pages, content hub — see [us-eu-features.md](us-eu-features.md)).

## Audit findings

**Blocking, outside the repo**

1. **`taomiq.uz` does not resolve.** Public resolvers and the PS Cloud nameservers return no records for the apex, `www` or `admin` (the domain was registered 23 Nov 2026). No TLS certificate is issued. Nothing can be indexed until DNS and certificates are live. Owner / operator.

**Wrong in code now**

2. Order pages inherit `canonical: /{locale}` from `src/app/[locale]/layout.tsx` — any page that forgets `alternates` silently canonicalises to home.
3. Open Graph tags on every child page are the home page's; no `og:url`, no `og:image`.
4. `robots.ts` disallows `/uz/order` and `/ru/order`, so crawlers never see their `noindex`.
5. The 404 page is the unbranded Next default (no `lang`, header or links).
6. Menu pages are indexable but empty until the menu cycle is filled in admin (content, not code).

**Missing foundation**

7. No favicon/icons, manifest, OG image or `llms.txt`; no `public/` directory.
8. Titles, h1s and descriptions miss the page-map keywords (home, programs, menu).
9. Sitemap has no `x-default` and no `lastModified`.
10. Structured data: Organization has no `logo`; no `BreadcrumbList`; `Product` has no `image`; no `LocalBusiness` (needs address, phone, hours).
11. Thin internal linking: program pages are linked only from home cards.
12. `admin.taomiq.uz/robots.txt` serves the public file; admin relies on a meta tag only.

**Verified fine:** root redirect by `Accept-Language`, trailing-slash and `www` redirects, 404 status codes, self-canonical + uz/ru/x-default on menu, calculator, delivery, privacy and program pages, one h1 per page, valid JSON-LD, prerendered pages, no `vercel.app` strings in HTML.

## Architecture

- **One metadata helper**, `src/lib/seo.ts`: `pageMetadata({ locale, path, title, description, index? })` returns `title`, `description`, `alternates` (self-canonical, `uz`, `ru`, `x-default` → uz) and `openGraph` (`url`, `title`, `description`, `locale`, `siteName`, `type`) plus `twitter`. Every public `generateMetadata` uses it. The layout keeps only `metadataBase`, the title template and site-wide defaults — **no `alternates`**.
- Non-indexable pages pass `index: false` → `robots: { index: false, follow: true }` and get no hreflang.
- Read `node_modules/next/dist/docs/01-app/03-api-reference/` for `generateMetadata`, `sitemap`, `robots`, `not-found`, `opengraph-image`, `manifest` and `icon` conventions before writing — this Next version differs from older ones.
- Structured data stays in `src/lib/structured-data.ts` and keeps its rule: state only what the page itself shows.
- New page types are static/ISR server components under `src/app/[locale]/`; copy lives in `src/i18n/uz.ts` and `ru.ts`.

## Data model

Slices 1–4: none. Slice 5 (blog, districts) will need tables or MDX — decided in that slice.

## Design rules

- Both locales, equal quality. Uzbek copy naturally includes the loanword variants people search with ("pp ovqat", "dostavka").
- No claims the site cannot back: no ratings, address or phone in schema until they exist; no medical promises.
- No `*.vercel.app` address anywhere. All absolute URLs come from `site.url`.
- New pages follow the brand tokens and the motion rules in [motion-mobile-ux.md](motion-mobile-ux.md).

## Slices

### 1. Metadata correctness (code only)

- `src/lib/seo.ts` helper; adopt it in home, menu, programs/[slug], calculator, delivery, privacy, order, order/success. Remove `alternates` and page-specific `openGraph` from the layout.
- Order and success pages: `noindex, follow`, no canonical to home.
- `robots.ts`: keep `/admin` disallowed, drop the two `/order` disallows.
- `sitemap.ts`: add `x-default` to alternates. No `lastModified` until a real per-page change date exists (a date that moves on every deploy gets ignored).
- Localised 404: `src/app/[locale]/not-found.tsx` (header, footer, links to home, programs, menu, in the page's locale) and a catch-all `[locale]/[...rest]/page.tsx` that calls `notFound()` so unknown paths under a locale render it. Status stays 404.
- `src/proxy.ts`: responses on the admin host carry `X-Robots-Tag: noindex, nofollow`.

### 2. Brand assets and share previews

- `src/app/icon.svg`, `apple-icon.png`, `manifest.ts` (name, theme `#183C34`, Ivory background).
- `opengraph-image.tsx` via `next/og` for home (per locale) and program pages (name, calorie levels, "from X so'm/day"); `twitter.card = summary_large_image`.
- Organization `logo`; `Product.image`.
- `llms.txt` route: what TAOMIQ is, programs, prices source, key URLs in both languages.

### 3. Keywords and on-page

- i18n: SEO title and description per page and per program slug, matched to the page map (home: "to'g'ri ovqatlanish yetkazib berish Toshkent" / «доставка правильного питания в Ташкенте»; LIGHT: "ozish uchun ratsion" / «питание для похудения»; PROTEIN: "proteinli ovqatlar" / «высокобелковое питание»; menu: "haftalik sog'lom menyu" / «меню правильного питания на неделю»; calculator ru adds «КБЖУ»).
- Home h1 keeps the slogan; a keyword-bearing subtitle sits directly under it. Program h1 gets a descriptive subtitle.
- `BreadcrumbList` on program, menu, calculator, delivery pages.
- Footer: links to the three programs, menu, calculator, delivery; menu and delivery pages link to programs.
- Owner skims the copy before it ships.
- Found while building slice 1, fix here: an unknown program slug (`/uz/programs/nope`) returns HTTP 200 in production builds because `notFound()` runs after the fallback shell is sent (a soft 404). Also, the localised 404 page returns status 404 and `noindex` but its server HTML is an empty shell under `cacheComponents` (content is drawn in the browser, and the tab title falls back to the default).

### 4. Evergreen pages

- `/faq` (reuses `t.faq`, grouped by topic; `FAQPage` schema moves here, home keeps a short list).
- `/prices` generated from the catalogue: every program × level × duration, `Offer` schema.
- Goal landing pages on one template (h1, intro, sample day, how it works, FAQ, cross-links): weight loss, high protein, balanced, halal.
- Calculator suite: protein, TDEE, BMI, water — each its own indexable page ending in a recommended program.
- `/about` (kitchen, halal, team) and `LocalBusiness` — when the owner supplies text, photos, address, phone, hours.

### 5. Content hub and local pages

- Blog with `Article` schema and a named reviewer; the 10 launch articles from 06 §4.
- District pages only for districts actually served, each with real windows.
- `/corporate` lead form.

Needs content from the business and a storage decision (MDX in repo vs Supabase table).

## Owner-only, outside the repo

1. **DNS at PS Cloud** for apex, `www`, `admin` → Vercel; confirm certificates issue. Blocks everything.
2. **Google Search Console**: domain property via DNS TXT; submit `sitemap.xml`.
3. **Yandex Webmaster**: verify, region Tashkent, submit sitemap; add Yandex Metrica.
4. **Google Business Profile, Yandex Business, 2GIS**: identical name, address, phone; link to `/order`.
5. Confirm `@taom_iq` on Telegram and Instagram (both are already in the Organization `sameAs`).
6. Fill the menu cycle in admin; dish photos; kitchen/halal facts; address, phone, hours.

## Risks and open questions

- Until the menu has data, `/menu` is thin. Proposal: leave it in the sitemap but fill at least one program before submitting the sitemap to search engines.
- Keyword volumes are still unvalidated (Yandex Wordstat, Google Keyword Planner) — slice 3 copy uses the seed list.
- Goal landing URL slugs: transliterated Uzbek (`/uz/ozish-uchun-ratsion`) and Russian (`/ru/pitanie-dlya-pohudeniya`) differ per locale, or one shared English slug? Proposal: shared neutral slugs (`/goals/weight-loss`) — simpler hreflang; keywords live in title, h1 and copy.

## Status (23 Nov 2026)

| Slice | State |
|---|---|
| 1 Metadata correctness | Shipped (`c51f6be`) |
| 2 Brand assets and share previews | Shipped: icons and share image came with the logo work; manifest, `llms.txt`, large Twitter card in `5402b79`. Per-program share images and `Product.image` not done (no program images) |
| 3 Keywords and on-page | Shipped (`5402b79`), now in uz, uzc and ru. Unknown program slugs return a real 404. The localised 404 page still has an empty server HTML shell (no supported fix found in Next 16.4 with `cacheComponents`) |
| 4 Evergreen pages | Shipped: `/faq`, `/prices` (`5dc4235`); goal pages `/goals/{weight-loss,high-protein,balanced,halal}` and `/calculator/{protein,bmi,water}` (`7367a70`). `/about` and `LocalBusiness` wait for owner content |
| 5 Content hub and local pages | Not started: needs articles, served districts, and a storage decision |

Still open outside the repo: DNS delegation for `taomiq.uz` (zone exists at PS Cloud with correct records; the `.uz` registry had not published the delegation), Search Console, Yandex Webmaster, business listings. All new Uzbek copy (Latin and Cyrillic) needs a native editor's pass.
