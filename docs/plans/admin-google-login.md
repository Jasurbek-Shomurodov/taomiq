# Google sign-in on the back-office login

## Goal and user flow

Staff can sign in to `admin.taomiq.uz` with Google as well as with email and password.

1. `/login` on the admin host shows the existing email/password form, then a divider ("or") and a
   **Sign in with Google** button.
2. The button sends the browser to Google (through Supabase), which returns to
   `https://admin.taomiq.uz/auth/callback`.
3. The callback exchanges the code for a session, checks the `staff` table, and goes to `/`.
4. A Google account that is not staff is signed out again on the spot and lands on
   `/login?error=not-staff` (the existing notice). Cancelling at Google returns to `/login` with no
   error; any other failure shows one sentence (`/login?error=google`).

Google never grants access by itself: access is still the `staff` row. Supabase links a Google
identity to the existing user with the same **verified** email, so the owner (a confirmed Gmail
address, checked 24 Nov 2026) becomes the same user and keeps the same `staff` row. Staff are still
added by hand; nothing here creates a staff row.

## Architecture

- **Switch:** server-only env `ADMIN_GOOGLE_LOGIN` (`on` shows the button; anything else hides it and
  the action and callback refuse). It is separate from `NEXT_PUBLIC_AUTH_METHODS`, so the back office
  can use Google before customer accounts open on the public site. Read in
  `src/app/admin/login/page.tsx` (already dynamic: it reads cookies) and passed to the form as a prop.
  One helper, e.g. `isAdminGoogleLoginOn` in `src/lib/admin/`, also requires `isSupabaseConfigured`.
- **Start:** new server action `signInWithGoogle()` in `src/lib/admin/actions.ts`:
  `supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, queryParams: { prompt: "select_account" } } })`,
  then `redirect(data.url)`. The PKCE verifier cookie is set on the admin host, so the return must
  come to the admin host too.
- **`redirectTo`:** the admin origin + `/auth/callback`. Build the admin origin from the configured
  site URL (`src/lib/site.ts`) by prefixing the host with `admin.` (`https://admin.taomiq.uz`,
  `http://admin.localhost:5555`). Do not build it from the request's Host header. No `*.vercel.app`.
- **Callback:** new route `src/app/admin/auth/callback/route.ts`. On the admin host `proxy.ts`
  rewrites `/auth/callback` to `/admin/auth/callback`, so no proxy change is needed (confirm; fix the
  comment in `src/app/auth/callback/route.ts` and `proxy.ts` that says the route does not exist
  there). Steps: flag off → `/login`; no `code` → `/login` (`access_denied`) or `/login?error=google`
  (log the reason); `exchangeCodeForSession`; read the caller's own `staff` row (`locale`) with the
  session client; no row → `signOut({ scope: "local" })` then `/login?error=not-staff`; row → set
  the admin locale cookie exactly as `signIn` does, then `/`. Redirects are relative to
  `request.nextUrl.origin`, status 303. It does **not** call the customer `syncProfile`.
- **UI:** `src/app/admin/login/LoginForm.tsx` gets a second `<form action={signInWithGoogle}>` below
  the password form (forms cannot nest), behind the flag: divider, then a white outline button with
  the Google mark, pending state via `useFormStatus`. Move `GoogleIcon` out of
  `src/app/[locale]/login/LoginForm.tsx` into a shared component and use it in both places.
  The `?error=google` sentence is shown next to the existing not-staff notice.
- **Bot check:** none on the Google button; Supabase takes no CAPTCHA token on an OAuth redirect
  (same as the customer buttons).

## Data model

No migration. `staff`, its RLS and `requireStaff()` are unchanged. A non-staff person who tries
Google here leaves a plain Supabase user (the same as a customer account) with no access to anything.

## Design rules

- Existing tokens and classes only (`btn`, `btn-outline`, `field`); button at least 48 px tall, full
  width, same radius as "Войти".
- Text in `src/i18n/admin/ru.ts`, `uz.ts`, `uzc.ts`: `login.google`, `login.or`,
  `login.redirecting`, `login.googleFailed`. No hardcoded strings.
- States: idle, pending ("redirecting"), not staff, Google failed, flag off (no divider, no button).

## Slices

1. **Google button, action and callback** (everything above), `.env.example` entry for
   `ADMIN_GOOGLE_LOGIN` with the setup notes below, and an e2e check that the admin login has no
   Google button when the flag is unset (only if the smoke suite already reaches the admin host).
1b. **Elegant login page** (owner's request, 24 Nov 2026; same files as slice 1, ships with it).
   Read `docs/01-brand-foundation.md` and `src/app/globals.css` first; existing tokens, fonts and
   utilities only, no new images or libraries.
   - **Page:** the flat forest background gains quiet depth: a soft radial gold glow behind the card
     and a darker vignette at the edges (CSS gradients only). The language switch leaves the card
     and sits in the top-right corner of the page (on-dark variant). A small muted footer line under
     the card links to `taomiq.uz`.
   - **Card:** `max-w-md`, roomier padding (`p-8`, `sm:p-10`), a hairline gold-tinted border and a
     soft deep shadow. Lockup centred, then a serif heading (`login.heading`, e.g. "Добро
     пожаловать") and the existing "Панель управления" label under it, with more air between blocks.
   - **Order of sign-in:** when the flag is on, the Google button comes **first**, then the "or"
     divider (hairlines either side), then email and password. Flag off: the form alone, no divider.
   - **Fields and buttons:** all 48 px tall; calm labels; clear gold focus ring; a show/hide password
     toggle (`login.showPassword` / `login.hidePassword`, `aria-pressed`, at least 44 px target);
     the primary button full width with the pending state it has now.
   - **Notices:** error and not-staff messages keep `role="alert"`, with a small icon and the same
     danger tint, placed directly above the button they relate to.
   - **Motion:** the card fades and rises once on load using the project's existing motion
     utilities; nothing moves under `prefers-reduced-motion`.
   - **Shell:** extract the page shell (background, corner language switch, card, footer) into one
     component and use it for `/login` and `/setup` so both look the same; update both Suspense
     fallbacks to the new card size so nothing jumps.
   - Check at 360 px and desktop widths, in ru, uz and uzc (longer strings must not wrap badly),
     keyboard order (Google → email → password → toggle → submit), and AA contrast.
2. **Outside the repo (operator + owner).**
   - Google Cloud: project, OAuth consent screen (External, app name Taomiq, scopes
     `openid email profile`), OAuth client of type Web application with authorised redirect URI
     `https://cysswfmzntmhfpcymhdf.supabase.co/auth/v1/callback`.
   - Supabase → Authentication → URL Configuration: add `https://admin.taomiq.uz/auth/callback` and
     `http://admin.localhost:5555/auth/callback` to the redirect allow-list.
   - Supabase → Authentication → Providers → Google: client ID (operator), **client secret (owner
     types it)**, enable.
   - Vercel: `ADMIN_GOOGLE_LOGIN=on` for Production and Development, then redeploy.
   - Live check: owner signs in with Google on `admin.taomiq.uz`; a non-staff Google account is
     refused.

## Risks and open points

- If a staff email is not the Google account's email, Google creates a separate user with no staff
  row and the person is refused. Staff emails must match their Google accounts.
- Automatic linking needs the existing user's email to be confirmed (it is for the owner). Keep
  "Confirm email" on.
- The consent screen starts in Testing mode (only listed test users can sign in). Publishing it for
  `openid email profile` needs no Google review; do that before customer Google sign-in opens.
- The Google client secret is entered by the owner, never by an agent.
