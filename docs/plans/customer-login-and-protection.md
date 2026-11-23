# Customer login (Google, Telegram, email) and site protection

Decided with the owner on 2026-11-23. Everything here must cost nothing.

## Goal

A customer can sign in on taomiq.uz with **Google**, **Telegram** (which also gives us a
Telegram-verified phone number: this is the "phone login") or an **email code**, sees their own
orders, and gets the order form pre-filled. The public forms and the login are protected against
bots and floods with **Vercel Firewall** rules and **Cloudflare Turnstile**.

Not in scope: SMS codes (never free: Firebase needs a billing account, Eskiz needs a registered
business; see `docs/05-technical-architecture.md` §7, which stays the later plan), the Cloudflare
proxy (Vercel advises against a proxy in front of it and already mitigates DDoS on every plan),
payments, subscriptions, pause/skip.

This replaces "phone-first OTP" in `docs/05` for the soft launch only. Ordering still never
requires an account.

## User flow

1. Header (and the mobile menu) shows "Kirish / Войти". Signed in, it shows the account entry.
2. `/[locale]/login`: three buttons in this order: **Telegram**, **Google**, then an email field
   ("send me a code"). Only the methods switched on in the environment are shown. A `next` query
   value (same-site path only) returns the customer where they came from, e.g. the order form.
3. Telegram and Google: redirect to the provider, back to `/auth/callback`, then on to `next` or
   `/[locale]/account`.
4. Email: enter email → 6-digit code arrives → enter code on the same page → signed in.
5. `/[locale]/account`: name, phone, email, sign-in methods, "my orders" (number, program, dates,
   total, status), a sign-out button, and a link to order again.
6. Order form, signed in: name and phone pre-filled from the profile; the order is saved against
   the account. Signed out: exactly as today.

## Architecture

- **Auth:** Supabase Auth, the same project the back office uses. No Firebase, no new auth library.
  - Google: built-in `google` provider.
  - Telegram: Supabase **custom OIDC provider** `custom:telegram`, issuer
    `https://oauth.telegram.org`, scopes `openid profile phone`, `email_optional: true`. Client id
    is the bot id, secret comes from @BotFather → Login Widget. Docs:
    `https://supabase.com/docs/guides/auth/custom-oauth-providers`,
    `https://core.telegram.org/bots/telegram-login`.
  - Email: `signInWithOtp({ email })` + `verifyOtp({ type: 'email' })`, 6-digit code (the email
    template prints `{{ .Token }}`, no magic link). Needs custom SMTP in Supabase (Resend free
    tier); the built-in mailer only sends to team members.
- **Which methods are shown:** `NEXT_PUBLIC_AUTH_METHODS`, a comma list of `telegram`, `google`,
  `email`. Empty or unset → no login link anywhere and `/login` + `/account` return 404. This keeps
  `main` safe to ship before the dashboards are configured, and keeps the demo-mode e2e build
  unchanged.
- **Routes** (read `node_modules/next/dist/docs/` first, this Next.js differs from older ones):
  - `src/app/[locale]/login/page.tsx` + client `LoginForm`.
  - `src/app/auth/callback/route.ts`: exchanges the `code` for a session
    (`exchangeCodeForSession`), syncs the profile, redirects. Public host only. Add `auth/` to the
    locale-redirect skip in `src/proxy.ts` (today only `_next/`, `api/` and files are skipped).
  - `src/app/[locale]/account/page.tsx`: dynamic, server-rendered, `noindex`.
  - Server actions in `src/lib/account/actions.ts`: `startOAuth(provider, locale, next)`,
    `requestEmailCode`, `verifyEmailCode`, `signOut`, `updateProfile(name)`.
- **Session:** `createSessionClient()` in `src/lib/supabase/server.ts` already does cookies; reuse
  it. Add `src/lib/account/auth.ts` with `getCustomer()` (cached per render, returns user + profile
  or null) and `requireCustomer(locale)` (redirects to login with `next`).
- **Static pages stay static.** Marketing pages must not read cookies on the server. The header
  shows the signed-in state from a small client component using the browser Supabase client
  (`src/lib/supabase/browser.ts`), rendering the signed-out link first so there is no layout jump.
  Do not add a session refresh to `proxy.ts` for every page; the browser client refreshes tokens,
  and `/account` + server actions use `getUser()`.
- **Open redirect:** `next` is accepted only when it starts with a single `/` followed by a valid
  locale segment; anything else falls back to `/[locale]/account`.
- **Staff vs customers:** the back office keeps its own gate (`requireStaff`, the `staff` table,
  `private.is_owner()`). A customer account never has a `staff` row, so it gets nothing there.
  Nothing in this plan may loosen an existing policy.

## Data model: migration `0006_customer_accounts.sql` (additive only)

- `public.profiles`
  - `id uuid primary key references auth.users (id) on delete cascade`
  - `name text not null default ''` (max 80)
  - `phone text` null, check `^\+998[0-9]{9}$`
  - `phone_verified boolean not null default false`: true only when the number came from the
    Telegram identity
  - `telegram_id bigint` null, unique
  - `locale text not null default 'uz'` check in (`uz`, `uzc`, `ru`)
  - `created_at`, `updated_at` (reuse `private.set_updated_at()`)
  - RLS on. `authenticated` may `select` own row (`id = (select auth.uid())`) and `update` only
    `name` and `locale` of own row (column grants, like `orders`). No insert/delete from the
    client. Owner may `select` all (`private.is_owner()`).
  - Row created by a `security definer` trigger on `auth.users` insert (function in `private`,
    `search_path = ''`, execute revoked from public). The trigger must never fail a sign-up.
  - `phone`, `phone_verified`, `telegram_id` are written only by the server with the secret key,
    in the callback, from the **`custom:telegram` identity's** `identity_data`
    (`phone_number`, `id`), never from user-editable `user_metadata`. Telegram returns the number
    without `+`; store it as `+998…` and only when it matches the Uzbek pattern.
- `public.orders`
  - add `user_id uuid null references auth.users (id) on delete set null`, index
    `(user_id, created_at desc)`.
  - new policy "customer reads own orders": `select` to `authenticated` using
    `user_id = (select auth.uid())`. Customers get no update. `staff_note` and `ip_hash` must not
    reach customers: read orders for the account page through a `security invoker` view or an
    explicit column list plus column-level `select` grants. Pick one and say why in the migration.
    Careful: `orders` currently has a table-level `select` grant to `authenticated`; narrowing it
    is a privilege change on an existing table, so keep the owner's access working and call it out
    for the reviewer.
  - `submit_order` gains a last parameter `p_user_id uuid default null` and stores it. Because a
    new parameter makes a new overload, drop the old signature in the same migration and re-state
    the execute privileges (service_role only), as `0005` did.
- Orders placed before sign-in are linked on sign-in **only by a verified phone**: in the callback,
  when the profile has `phone_verified`, set `user_id` on orders with the same `phone` and
  `user_id is null` (secret client). Never link by an unverified phone or by name.

## Protection

- **Turnstile** (free, Cloudflare account, no DNS change). `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
  `TURNSTILE_SECRET_KEY`. One `Turnstile` client component (script from
  `challenges.cloudflare.com`, managed mode, follows the page locale), one server helper
  `verifyTurnstile(token, ip)` calling `siteverify`. When the keys are unset the widget is not
  rendered and the check passes (demo mode, e2e).
  - Order form: verified in `submitOrder` before the database call. Keep the honeypot and the
    existing database rate limit.
  - Email code request and back-office login: the token is passed to Supabase as
    `options.captchaToken`, so Supabase Auth's own CAPTCHA protection can be switched on. That
    switch covers direct calls to the auth API with the public key, which our server check alone
    cannot.
  - If the site sends a Content-Security-Policy, allow `challenges.cloudflare.com` for script and
    frame.
- **Vercel Firewall** (operator). The team is on Hobby: 3 custom rules per project, only **one**
  of them a rate-limit rule (keyed by IP, fixed window). Nothing is configured today. Use:
  1. the one rate-limit rule, by IP, on `POST` requests to the order, login and `/auth/` paths on
     both hosts (server actions post to the page path);
  2. one challenge rule for requests to those paths with no browser-like user agent;
  3. one spare.
  Bot Protection managed ruleset on (challenge): it is free on every plan. Attack Challenge Mode
  stays off and is the panic button during an attack.
- **Supabase Auth rate limits** (operator): email sends per hour sized to the Resend free tier,
  OTP verify attempts left at defaults, leaked-password protection and CAPTCHA on.

## Design rules

- Mobile-first, existing brand tokens and components only; buttons at least 48 px tall. Telegram
  first because nearly every customer in Tashkent has it.
- All text in `src/i18n/uz.ts`, `uzc.ts`, `ru.ts`. No hardcoded strings.
- States: provider button pending; email code sent (with "send again" after 60 s and "change
  email"); wrong or expired code; provider cancelled or failed (`/login?error=…` shows one plain
  sentence); account with no orders (empty state with an "order" button); rate limited.
- `/login` and `/account` are `noindex` and absent from `sitemap.ts` and `llms.txt`.
- The privacy page gains one paragraph: what is stored for an account (name, phone, email,
  Telegram id) and that sign-in is through Google/Telegram.
- No `*.vercel.app` address anywhere; redirect URLs are built from `NEXT_PUBLIC_SITE_URL`.

## Slices

1. **Accounts and sign-in.** Migration `0006` (profiles + trigger + policies only; the `orders`
   changes wait for slice 2). `NEXT_PUBLIC_AUTH_METHODS` gating, `/login`, `/auth/callback`,
   `/account` (profile, sign-in methods, sign out, edit name), header entry, proxy skip, i18n,
   privacy paragraph, `.env.example`. E2E: with methods unset, `/uz/login` is 404 and the header
   has no login link.
2. **Orders on the account.** Migration `0007` (`orders.user_id`, customer read access,
   `submit_order` with `p_user_id`). Order form pre-fill and saving against the account, verified-
   phone linking in the callback, "my orders" on `/account`.
3. **Turnstile.** Widget + server check on the order form, the email-code form and the back-office
   login; env names in `.env.example`.
4. **Outside the repo (operator + owner).** Google OAuth client, Telegram Login Widget in
   @BotFather, Resend + SMTP, Supabase providers/redirect URLs/email template/CAPTCHA, Turnstile
   site, Vercel env vars, Vercel Firewall rules. Then a live check of each sign-in method.

## Risks and open points

- **Telegram through Supabase's custom OIDC provider is unproven here.** Telegram has no UserInfo
  endpoint, requires HTTP Basic on the token call, and the docs do not say whether the raw endpoint
  echoes `nonce` (`skip_nonce_check` exists for that). If the live test in slice 4 fails, the
  fallback is our own callback route: do the OIDC code flow ourselves, verify the ID token against
  Telegram's JWKS, then find-or-create the Supabase user with the secret key and mint a session
  server-side. Keep `startOAuth` behind one function so only that function changes.
- Telegram does not say whether a user may decline to share the phone and still sign in. Treat the
  phone as optional everywhere.
- Supabase links identities with the same **verified** email to one user. A staff member who signs
  in with Google on the public site becomes the same user as their staff login; that is intended,
  and the staff gate is unchanged.
- From the slice 1 review:
  - **`email` stays out of `NEXT_PUBLIC_AUTH_METHODS` until slice 3 is live and Supabase CAPTCHA is
    on.** The email-code action runs on the server, so Supabase's per-IP limits see Vercel's
    addresses; without the bot check anyone can burn the hourly email quota.
  - Slice 3 also refreshes the session in `proxy.ts` for `/:locale/account` and `/:locale/login`
    only (a Server Component cannot store a refreshed token, which can sign a returning customer
    out). Marketing pages stay untouched.
  - Setup: keep "Confirm email" on in Supabase; `www.taomiq.uz` must keep redirecting to the apex;
    `NEXT_PUBLIC_SITE_URL` must be the exact host per environment; the redirect allow-list needs
    `https://taomiq.uz/auth/callback**` and the localhost equivalent; Telegram scopes
    `openid profile phone` are set on the Supabase provider.
- Secrets (Google client secret, Telegram client secret, Resend key, Turnstile secret) are entered
  by the owner, never by an agent.
- Resend's free tier and Supabase's free custom-provider allowance (3) are enough now; both are
  limits to watch, not costs.
