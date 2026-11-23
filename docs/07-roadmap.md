# 07 · Roadmap

Durations are build estimates for the website, assuming content and decisions arrive on time. The business track runs in parallel and contains the longest lead times.

## Track A — Business prerequisites (start immediately)

| Item | Why it blocks | Lead time |
|---|---|---|
| Register `taomiq.uz` with a local accredited registrar | Domain is free today; needed for everything | 1 day |
| Reserve @taom_iq on Instagram and Telegram (channel + bot) | Brand handles | 1 day |
| Legal entity (IP or OOO), bank account, IKPU codes | Payme/Click/Eskiz contracts all require it | 1–3 weeks |
| Payme Business and Click merchant applications | Online payment | 1–2 weeks after the entity |
| Eskiz SMS contract and template approval | Phone login | ~1 week |
| Lawyer/accountant review: data law, offer text, VAT regime, fiscal receipts, sanitary requirements | Launch compliance | 1–2 weeks |
| Trademark search and filing for TAOMIQ | Protect the name | filing in days; registration takes months |
| Vector logo, final fonts, program tag colours | Design | 1 week |
| Final menu with verified КБЖУ; dish photo shoot | Menu pages, labels | 2–4 weeks |
| Prices, delivery zones, windows, cutoff | Order flow | decision |

## Track B — Website build

| Phase | Scope | Duration |
|---|---|---|
| **0. Setup** | GitHub repo, Next.js project, Supabase projects (staging + production, Frankfurt), Vercel project and domain, CI, brand design tokens, i18n skeleton (uz/ru) | 2–3 days |
| **1. Marketing site** | Home, programs, menu, calculator, delivery, about, FAQ, corporate, legal pages; SEO foundation (metadata, hreflang, sitemap, structured data); analytics; lead form → Telegram | ~2 weeks |
| **2. Ordering** | Database schema and RLS, pricing engine, order configurator, address check with zones, phone OTP login, Payme and Click integration (sandbox → live), confirmation flow | ~2–3 weeks |
| **3. Account and admin** | Account (calendar, skip/pause, address, receipts, cancel), admin (orders, production sheet, delivery sheet, menu editor, prices, promos, leads), Telegram bot notifications | ~2–3 weeks |
| **4. Launch readiness** | Content loading in both languages, real photos, end-to-end tests, performance and accessibility pass, tests on local mobile networks, soft launch with friends and family | ~1 week |

**Soft launch possible after phase 1** with ordering via a lead form, if the kitchen is ready before payments are approved. Full self-service launch after phase 4: roughly 8–10 weeks from start.

## Track C — After launch

| Priority | Item |
|---|---|
| 1 | Referral programme; review collection on Google and Yandex Maps |
| 2 | Telegram Mini App for ordering and plan management |
| 3 | Saved-card auto-renewal (Payme Subscribe / Click tokens) |
| 4 | Uzum Bank payments |
| 5 | GAIN and ACTIVE programs; OFFICE for companies |
| 6 | Courier app with status updates; packaging take-back |
| 7 | Nutritionist consultations as a bookable service |

## First steps once the docs are approved

1. Decide the open questions marked **blocking** in [08-open-questions.md](08-open-questions.md).
2. Register the domain and handles.
3. Create the GitHub repository, Supabase and Vercel projects (phase 0).
4. Build the home page and one program page with placeholder content to settle the visual design before the rest.
