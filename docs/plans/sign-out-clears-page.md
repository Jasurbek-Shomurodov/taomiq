# Plan · Sign-out leaves no customer data in the browser

Status: approved for build, 24 Nov 2026. Shared-device privacy fix for `/[locale]/account`.

## Problem (reproduced)

Reproduced with Playwright against a production build (`cacheComponents: true`) pointed at a local mock Supabase,
customer "Zarina Testova", phone, email and order #4242:

| Step | Customer data in the DOM | Visible |
|---|---|---|
| `/uz/account` signed in | yes | yes |
| Sign out → `/uz` (server action `redirect`) | **yes** | no |
| Back → `/uz/account` → server redirects to `/uz/login` | **yes** when `/account` was the first page loaded; no when reached by a link | no |
| Forward / Back again | **yes** (first-load case) | no |

Cause: the sign-out is a server action that ends in `redirect()`, so Next.js does a *client-side* navigation. The
document, the JS heap and the router stay alive:

- Cache Components keeps the last routes mounted in a hidden React `<Activity>` (`display: none`), so the account
  page with the name, phone, email and orders stays in the DOM after the sign-out.
- When `/account` was the first page loaded, its RSC payload (`self.__next_f` inline scripts) holds the same data for
  the life of the document.
- Anyone on the shared device can read it with devtools, and on a slow phone the kept page can be shown again for a
  moment on Back before the server's redirect lands. Headless Chromium on a fast local server did not paint it, but the
  data is there to paint.

Already fine: `/account` responses carry `Cache-Control: private, no-cache, no-store` (Supabase's headers via
`src/proxy.ts`), so the HTTP cache does not hold the page.

## Fix

Sign-out ends with a **full document navigation that replaces the current history entry**, so the old document
(DOM, Activity, router cache, RSC payload, JS memory) is thrown away and the account entry is not kept for Back.

### Flow

1. Customer taps "Chiqish / Выйти".
2. `onSubmit`: `resetAnalytics()` (as today), `preventDefault()`, then call the `signOut` server action in a transition
   (button shows "signing out" via its own pending state).
3. The action signs out (`scope: "local"`, as today) and **returns** (no `redirect()` when called from JS).
4. The client then does `window.location.replace(`/${locale}`)`: a fresh document; the `/account` entry is replaced, so
   Back goes to the page before it. Any older `/account` entries in history belong to the discarded document and are
   loaded fresh from the server (signed out → `/login`).
5. If the action throws (network), still `location.replace` home: the cookies may be unchanged, but a fresh load
   shows the server's truth. (Supabase `signOut` local errors only log today; keep that.)

No JS (before hydration): the plain form post still runs the action. Keep it working: the action may keep a
server-side `redirect(`/${locale}`)` for that path only, or return and let the re-rendered `/account` redirect to
`/login` — builder picks whichever is simpler and correct; with JS the client must never take Next's soft redirect.
One clean way: the JS path calls a separate exported action (or passes an argument such as `{ hard: true }`) that does
not redirect; the form's `action` attribute keeps the redirecting one.

### Defence in depth (small)

- The account page's client component adds a `pageshow` listener that reloads when `event.persisted` (a browser that
  restores the page from bfcache despite `no-store`, e.g. older Safari). Only while the account page is mounted.

### Not doing

- `Clear-Site-Data` header: heavy (clears storage for the whole origin, also PostHog/order drafts) and not needed once
  the document is replaced.
- Keying the subtree on the session / `router.refresh()`: a soft refresh still keeps the old document and the inline
  RSC payload; the hard navigation covers every case at once.

## Files

- `src/lib/account/actions.ts` — `signOut` returns without `redirect()` for the JS path (see above).
- `src/app/[locale]/account/AccountForms.tsx` — `SignOutButton`: `onSubmit` → reset analytics, call the action,
  `location.replace`; pending state; `pageshow` guard.
- Comment in `AccountForms.tsx` explaining why sign-out is a hard navigation (Activity, RSC payload, shared devices).

No data model change, no migration, no new env var.

## E2E test

The gate's e2e build has sign-in off (no Supabase keys), so a signed-in account page needs its own server:

- `scripts/e2e-mock-supabase.mjs`: a tiny `node:http` mock of the Supabase endpoints the account flow uses, on
  localhost only: `GET /auth/v1/user` (200 with a fixed user when the bearer token is the test token, else 401),
  `POST /auth/v1/logout` (204), `GET /rest/v1/profiles` (object for `Accept: application/vnd.pgrst.object+json`,
  else array), `POST /rest/v1/rpc/my_orders`, and the catalogue reads the build needs (`programs`, `durations`,
  `menu_items`, `settings`…; `generateStaticParams` of `/[locale]/programs/[slug]` fails on a fetch error and may need at
  least one program). Serve the demo catalogue (`src/lib/data/demo.ts`) or a minimal hand-written fixture; do not rely
  on packages that are not direct dependencies (jiti is only transitive).
- `scripts/e2e-account-server.mjs` (or an option of `e2e-server.mjs`): starts the mock, builds into its own dist dir
  (e.g. `.next-e2e-account`, own tsconfig or reuse `tsconfig.e2e.json`; keep `next-env.d.ts` restored as
  `e2e-server.mjs` does) with `NEXT_PUBLIC_SUPABASE_URL=http://localhost:<mockPort>`, a dummy publishable key,
  `NEXT_PUBLIC_AUTH_METHODS=email`, every other secret empty as in `DEMO_ENV`, and `next start` on its own port.
- `playwright.config.ts`: a second `webServer` and an `account` project (Desktop Chrome, plus phone if cheap) matching
  only the new spec; the existing projects must not run the new spec and vice versa (the existing account spec asserts
  sign-in is off). Add `.next-e2e-account` to `.gitignore` and to the eslint ignores if `.next-e2e` is there.
- `e2e/account-signout.spec.ts`: set the `sb-localhost-auth-token` cookie (`base64-` + base64url JSON session, as
  `@supabase/ssr` writes it) in the context, then for both entry paths (direct load of `/uz/account`, and a link click
  from `/uz/menu`):
  1. the account page shows the name, phone, email and order number;
  2. sign out → on `/uz`, **none of those strings are anywhere in `document.documentElement.outerHTML`**;
  3. Back → none in the HTML, and the URL ends on the login page or the page before (never the account page with
     data); poll for a couple of seconds so a late paint is caught;
  4. Forward and Back again → still none.
  The existing `FORBIDDEN` guard in `e2e/fixtures.ts` stays (the mock is localhost, never `*.supabase.co`).
- Check the test **fails on today's code** (step 2 fails) before the fix, and passes after.

## Slices

1. Fix + e2e test together (one commit): the test is the proof.

## Risks

- Extra build in the gate (~1 min). Acceptable; keep it one build for all locales.
- Port clashes: pick ports next to 5599 and make them overridable like `E2E_PORT`.
- `location.replace` skips Next's router: the home page loads fresh (one full page load after sign-out). Fine.
