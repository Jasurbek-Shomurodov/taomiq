# Plan · Product analytics with PostHog

Status: approved for build, 24 Nov 2026. Changes the analytics row of [05-technical-architecture.md](../05-technical-architecture.md).

## Goal

See how people move through taomiq.uz, above all where they leave the three-step order form, and see the errors they hit, without loading five third-party scripts on a phone.

Decision:

| Job | Tool |
|---|---|
| Product analytics, funnels, session replay, client and server errors | **PostHog, EU cloud (Frankfurt)** |
| Ad attribution (Yandex Direct goals, Webvisor) | Yandex Metrica, later, in [findability-and-growth.md](findability-and-growth.md) |
| Ad attribution (Instagram ads) | Meta Pixel + Conversions API, later |
| Google search | Search Console (no GA4 unless Google Ads are run) |
| Dropped | GA4, Vercel Analytics, Sentry |

Out of scope: Metrica, Meta Pixel, feature flags and A/B tests (PostHog can do them later), cookie banner (not required under Uzbek law for analytics; the privacy policy discloses it).

## Behaviour

- **No key, no PostHog.** When `NEXT_PUBLIC_POSTHOG_KEY` is unset (local dev, demo mode, the e2e build, Preview), nothing loads, no request is made and every capture call is a no-op. The key is set in Vercel **Production only**.
- **Public host only.** Never loaded on `admin.taomiq.uz` / `admin.localhost` or under `/admin`. Staff screens hold customer PII.
- **First-party proxy.** The browser sends to `taomiq.uz/<path>` and a Next.js rewrite forwards to `eu.i.posthog.com` (and `eu-assets.i.posthog.com` for static). Use a neutral path, not `ingest` or `posthog` (ad blockers list those). Add the path to the `src/proxy.ts` matcher exclusions so it is never locale-redirected, and set `skipTrailingSlashRedirect: true`. `ui_host` is `https://eu.posthog.com`.
- **Privacy.**
  - `person_profiles: "identified_only"`: anonymous visitors get no person profile.
  - Session replay: all inputs masked (default), plus any element marked `data-ph-mask` (names, phones, addresses shown back on the order summary, success page and account page) has its text masked. Replays never record `/account` content unmasked.
  - Never send name, phone, email, address or comment as event or person properties. Identify by Supabase user id only.
  - Respect Do Not Track (`respect_dnt: true`).
- **Errors.** Client: `capture_exceptions: true`. Server: `onRequestError` in `src/instrumentation.ts` sends the error with `posthog-node` (no request body, no cookies, no headers beyond path and method).

## Architecture

| Piece | Where |
|---|---|
| Client init (only when the key is set and the host is public) | `src/instrumentation-client.ts` (read this Next version's docs: `node_modules/next/dist/docs/`) |
| Tiny typed wrapper: `track(event, props)` and the event-name union, no-op without the key | `src/lib/analytics/client.ts` |
| Server capture (`posthog-node`, `flushAt: 1`, `flushInterval: 0`, awaited `shutdown`/`flush` so serverless functions don't drop events) | `src/lib/analytics/server.ts` |
| Server errors | `src/instrumentation.ts` → `onRequestError` |
| Rewrites + `skipTrailingSlashRedirect` | `next.config.ts` |
| Matcher exclusion for the proxy path | `src/proxy.ts` |
| Identify / reset | account page (identify with user id when signed in), sign-out (`reset()`) |
| Privacy text (uz, uzc, ru) | `src/i18n/*.ts` → `privacy.sections` |

The distinct id for server events: read it from PostHog's cookie (`ph_<key>_posthog`, JSON with `distinct_id`) when present; otherwise use the signed-in user id; otherwise skip the server event rather than invent an id.

No database change. No migration.

## Events

Keep the list short. Every event carries `locale` (uz / uzc / ru). Pageviews are automatic (`defaults` set to the current PostHog defaults date, which captures SPA navigations).

| Event | Where | Properties |
|---|---|---|
| `order_step_viewed` | OrderForm, on each step shown (phones: 1, 2, 3; desktop: single page = step 1 only once) | `step`, `layout` (`steps` / `single`) |
| `order_submitted` | OrderForm, on submit | `program`, `kcal`, `days`, `weekdays_only` |
| `order_failed` | OrderForm, when the action returns an error state | `reason` (field-error / server / turnstile) |
| `order_placed` | server, `submitOrder` after the RPC succeeds | `program`, `kcal`, `days`, `total_uzs`, `order_number` |
| `quiz_completed` | quiz result shown | `goal`, `program` |
| `calculator_used` | calculator result shown (once per visit) | `kcal` |
| `signed_in` | account page first render after login | `method` |

## Design rules

- No visible UI change. Bundle impact: posthog-js loads after hydration; it must not block LCP. Check the order page JS size before and after.
- `data-ph-mask` is an attribute only; no styling change.

## Slices

1. **Wiring.** `posthog-js` + `posthog-node`; client init in `instrumentation-client.ts` with the rules above (key gate, public host only, EU, proxy path, identified_only, masking, DNT, exceptions); rewrites + `skipTrailingSlashRedirect`; proxy matcher exclusion; `src/lib/analytics/client.ts` and `server.ts`; `onRequestError` in `src/instrumentation.ts`; `NEXT_PUBLIC_POSTHOG_KEY=` in `.env.example` with a comment. Gate passes with the key unset. Reviewer: yes (PII in replays and errors).
2. **Events and identity.** The event table above; `data-ph-mask` on PII text (order summary, success page, account page); identify on the account page, `reset()` on sign-out. Reviewer: yes (order flow, PII).
3. **Disclosure and docs.** Privacy policy section in uz, uzc and ru (what is collected, PostHog as processor, EU storage, inputs masked, DNT honoured); update the analytics/errors rows of `05-technical-architecture.md` and the tools line of `06-seo-marketing.md`. Must ship before or with the key going live.
4. **Go live (operator + user).** The user creates the PostHog EU project and adds `NEXT_PUBLIC_POSTHOG_KEY` (Production only) in Vercel; redeploy; operator checks on taomiq.uz that events arrive through the first-party path, that admin.taomiq.uz sends nothing, and builds the order funnel (`order_step_viewed` 1→2→3 → `order_placed`) in PostHog.

## Risks and open questions

- The project key is public by design (it ships to every browser), but by repo rule the user enters it in Vercel; no agent types it.
- Event volume: free tier is 1M events and 5k replays a month. Set replay sampling to 100% at launch; lower it if traffic grows.
- If PostHog's proxy path ever conflicts with a page slug, the rewrite wins; choose a path no locale page uses.
