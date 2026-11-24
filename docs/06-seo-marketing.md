# 06 · SEO and marketing plan

Scope: how taomiq.uz gets found and how visitors become subscribers. Facts marked ⚠ need confirmation.

## 1. The situation in one paragraph

Google holds about 76% of search in Uzbekistan and Yandex about 22%, so both matter. Instagram is the main sales channel for every competitor (largest audience seen: Daily Meal, 34.5K followers), Telegram is used for retention, and nobody in Tashkent has a fast, bilingual, content-rich site with real checkout. Competitor sites are thin, broken or Russian-only — organic search is open. No keyword volumes were obtained; the lists below are seeds to validate in Yandex Wordstat (region: Tashkent) and Google Keyword Planner.

## 2. Technical SEO (built into the site from day one)

| Item | Decision |
|---|---|
| URL structure | `/uz/…` (default), `/uzc/…` (Uzbek Cyrillic) and `/ru/…`; root `/` redirects by `Accept-Language` (`uz-Cyrl` → `uzc`, other `uz` → `uz`), falling back to `uz` |
| hreflang | `uz-Latn`, `uz-Cyrl`, `ru`, `x-default` → Uzbek Latin; reciprocal and self-referencing on every page |
| Uzbek script | Latin (default) and Cyrillic, as two locales; catalogue text falls back to a Latin→Cyrillic conversion until staff write it |
| Rendering | Static/ISR for all public pages; no content hidden behind client-side JS (Healthy Food's prices are invisible to crawlers for this reason) |
| Metadata | Unique title, description, canonical and Open Graph image per page and per locale |
| Structured data | `Organization` + `LocalBusiness` (address, hours, phone, geo), `Product` + `Offer` on program pages (price in UZS), `FAQPage`, `BreadcrumbList`, `Article` on blog, `AggregateRating` once real reviews exist |
| Sitemaps | `sitemap.xml` with locale alternates; submitted to Google Search Console and Yandex Webmaster (region set to Tashkent) |
| Indexing rules | `noindex` for `/account`, `/admin`, `/order` steps, search/filter parameter URLs |
| Performance | LCP < 2.5 s, CLS < 0.1 on 4G Android; AVIF/WebP images with fixed dimensions; fonts self-hosted with Cyrillic + Latin subsets |
| AI search | `llms.txt`, question-style headings with a direct answer in the first sentence |

## 3. Page map for search

Each row is one indexable page in both languages.

| Page | Russian target | Uzbek target |
|---|---|---|
| Home | доставка правильного питания ташкент; доставка здорового питания ташкент | to'g'ri ovqatlanish yetkazib berish toshkent; sog'lom ovqat yetkazib berish |
| Program: LIGHT | доставка еды для похудения ташкент; питание 1200 ккал | ozish uchun ratsion; ozish uchun ovqatlar |
| Program: BALANCE | рацион питания на день / на неделю; сбалансированное питание с доставкой | kunlik ratsion; kaloriya hisoblangan ovqat |
| Program: PROTEIN | высокобелковое питание доставка; спортивное питание рационы | proteinli ovqatlar; fitnes ovqatlar |
| Program: GAIN (phase 2) | питание для набора массы ташкент | massa yig'ish uchun ovqatlanish |
| OFFICE / corporate (phase 2) | здоровое питание в офис ташкент; бизнес-ланч доставка | ofisga sog'lom ovqat |
| Weekly menu | меню правильного питания на неделю | haftalik sog'lom menyu |
| Calorie calculator | калькулятор калорий; расчёт кбжу | kaloriya kalkulyatori |
| Delivery (+ district pages) | доставка пп [Юнусабад / Чиланзар / Мирзо-Улугбек …] | [tuman] yetkazib berish |
| Prices | рационы питания цены ташкент | ratsion narxlari |
| FAQ, About/Kitchen, Halal | халяль рационы ташкент | halol ratsion |

Uzbek speakers often mix in Russian loanwords ("pp ovqat", "dostavka"); include those variants naturally in Uzbek copy.

District pages are created only for districts actually served, each with a real delivery window and map — not doorway pages.

## 4. Content plan

Tone follows the brandbook: competent, calm, no miracle promises, no medical claims.

**Launch set (10 articles, both languages):**
1. How many calories do you need? (links to calculator)
2. What КБЖУ means and how to read a label
3. How much protein for muscle gain — plain numbers
4. Losing weight without hunger: how a 1,200–1,500 kcal day looks
5. Meal plan vs cooking yourself: honest cost comparison in Tashkent
6. What a week of TAOMIQ BALANCE looks like (real photos)
7. Eating right during Ramadan (seasonal; publish 6 weeks ahead)
8. Healthy eating at the office
9. How our kitchen works: sourcing, halal, safety
10. Best meal-plan deliveries in Tashkent — an honest comparison with a table

Then two articles a month, chosen from Search Console queries. A nutritionist is named as reviewer on each article.

**Free tool as an entry point:** the calorie and macro calculator is its own indexable page and ends with "your plan: PROTEIN / 2000".

## 5. Local search

- **Google Business Profile** and **Yandex Business** (Maps): category, kitchen address or service area, hours, photos, link to `/order`. Ask every satisfied customer for a Maps review from week one — Healthy Food has only 26 ratings on Yandex after ten years, so a visible lead is achievable quickly.
- **2GIS** listing; goldenpages.uz and yellowpages.uz for citations.
- Identical name, address and phone everywhere.
- PR: pitch inclusion in the Spot.uz and WeProject "ration delivery in Tashkent" roundups — both rank for the main queries today.

## 6. Paid and social channels

| Channel | Role | Notes |
|---|---|---|
| Instagram @taom_iq | Primary acquisition | 14.1M ad reach in Uzbekistan. Real dish photos, program cards, kitchen reels. Ads send traffic to the site checkout instead of Direct |
| Telegram channel + bot | Retention and service | Daily menu, delivery reminders, pause/skip. Paid posts in Tashkent city, fitness and food channels |
| Google Ads (Search) | Capture demand | Brand + "доставка правильного питания" type queries; reported CPC $0.15–0.50 ⚠ |
| Yandex Direct | Capture Russian-language demand | Paid in UZS via the local entity; minimum budget 100,000 UZS ⚠ |
| Influencers | Trust | Trainers, nutritionists, athletes: one free week + personal promo code, tracked per code |
| Gyms and clinics | Partnerships | Competitors already do this (Green Point–BeFit, Healthy Food–Medion). Offer members a code and trainers a referral fee |
| Corporate | B2B (OFFICE) | Lead form on `/corporate`; outbound to IT companies and banks |

TikTok is deprioritised (small official reach, reported as restricted ⚠).

**Seasonal moments:** New Year resolutions (January), pre-summer (March–May), Ramadan (suhoor/iftar-timed delivery), September back-to-routine.

## 7. Conversion

- Every ad and post lands on a page with a visible price and a "Choose plan" button — no "write to us for the price".
- Two paths: **self-checkout** (primary) and **"Consult a nutritionist in Telegram"** (secondary, creates a lead).
- **Trial offer:** 2 trial days at a modest discount. Deep first-order discounts attract customers who leave fastest, and the brandbook rules out loud discounting anyway.
- **Referral:** two-sided credit (friend gets a discount, referrer gets bonus days).
- Abandoned checkout: Telegram/SMS reminder after 1 hour and 24 hours (with consent).

## 8. Measurement

Tools: PostHog (EU) for product analytics, funnels, session replay and errors; Search Console and Yandex Webmaster for search. Later, for ad attribution: Yandex Metrica (with Webvisor) and Meta Pixel + Conversions API; GA4 only if Google Ads are run. UTM on every link; promo code per influencer.

| Metric | Why it matters |
|---|---|
| Visit → checkout start → paid, per channel | Funnel health |
| CAC per channel | Budget allocation |
| **Trial → second purchase rate** | Best early signal; industry range 35–50% |
| Monthly churn; pause vs cancel | Industry churn is 8–15% a month |
| Average order value and days per order | Pricing ladder effectiveness |
| Contribution margin per delivery day | After food, packaging (target 6,000 UZS/day per brandbook) and delivery |
| On-time delivery rate, dish ratings | Retention drivers |
| Organic impressions and position for the page-map queries | SEO progress |

## 9. First 90 days

| When | Actions |
|---|---|
| Before launch | Register domain; Search Console + Yandex Webmaster + Metrica; Google and Yandex business profiles; Instagram and Telegram populated with real dish photos; 10 launch articles written |
| Weeks 1–4 | Launch site in uz + ru; start Instagram ads and Google/Yandex brand + category search; 5–10 trainers/influencers on promo codes; collect first Maps reviews |
| Weeks 5–8 | First gym partnership; publish comparison article; review funnel data and fix the weakest step; start referral programme |
| Weeks 9–12 | Add district pages for proven zones; second content batch from real search queries; corporate outreach; decide on Telegram Mini App |
