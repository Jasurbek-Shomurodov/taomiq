# Plan · Staff access requests and the Team screen

## Goal

A manager who signs in at `admin.taomiq.uz` without a staff row sees "no access, contact the owner", and the owner has nowhere to see who that was or to let them in (today it takes SQL). After this plan:

- signing in to the back office without access **records a request**;
- the owner sees the people waiting on a new **Team** screen (with a count on the sidebar row), and approves or declines each one;
- the same screen lists current staff and lets the owner remove an admin.

Roles stay as they are (`owner`, `admin`). New roles (manager, cook) are being researched separately; this plan only has to make the role a constant list that is easy to extend.

## User flow

1. Manager opens `admin.taomiq.uz/login`, taps "Sign in with Google" (or enters an email and password).
2. No staff row → a request row is stored (once per account), the session is signed out as now, and the login page says: "Request sent. The owner will review it; sign in again once it is approved."
   - Already declined → the current "no access" text, nothing is re-opened.
3. Owner sees a badge on **Business → Team** and opens `/team`:
   - **Waiting**: name, email, when they asked. Buttons: Approve (grants `admin`), Decline. Approve asks for confirmation (`ConfirmDialog`) and names the email.
   - **Team**: name, email, role, since. Remove on admins only (confirmation). Owners cannot be removed here, including yourself.
   - **Declined** (collapsed, only when not empty): Approve is still possible.
4. Manager signs in again and lands in the panel.

## Architecture

- `src/lib/admin/access.ts` (server-only): `recordAccessRequest(user)` — called when a signed-in user has no staff row. Uses the secret client (`src/lib/supabase/secret.ts`). Email and name come from the verified session user (`user.email`, `user.user_metadata.full_name | name`), never from the request. Returns `"requested" | "declined"`. Never throws: on error it logs and returns `"declined"` (the old message).
- Callers: `src/app/admin/auth/callback/route.ts` (Google) and the password `signIn` action in `src/lib/admin/actions.ts`, both right before the sign-out. `requireStaff()` keeps redirecting to `/login?error=not-staff` and does **not** record (it runs on every panel render).
- New login state `?error=requested` → `t.login.requested` notice (neutral tone, not the red error).
- `src/app/admin/(panel)/team/page.tsx` (+ `loading.tsx`): `requireOwner()`, reads through the owner's session client via the RPCs below. Built from the admin kit (`Panel`, `Badge`, `EmptyState`, `Notice`, `Skeleton`).
- Server actions in `src/lib/admin/actions.ts`: `approveAccess`, `declineAccess`, `removeStaff` — each `requireOwner()`, call the RPC, `revalidatePath`.
- `src/app/admin/shell/nav.ts`: row `team` (`/team`, group `business`, `ownerOnly: true`, lucide `Users`). Badge `team` in the panel layout: pending count, same pattern as `NewOrdersBadge`, own `<Suspense>`.
- Dictionaries: `nav.team`, `login.requested`, `team.*` in `src/i18n/admin/{ru,uz,uzc}.ts`.

## Data model — migration `0008_staff_access_requests.sql` (additive)

```
public.staff_requests
  user_id    uuid primary key references auth.users (id) on delete cascade
  email      text not null check (char_length(email) <= 320)
  name       text not null default '' check (char_length(name) <= 80)
  status     text not null default 'pending' check (status in ('pending', 'declined'))
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()   -- private.set_updated_at() trigger
index on (status, created_at)
```

- RLS on. `revoke all … from anon, authenticated`; `grant select` to authenticated with policy "owner reads staff requests" `using (private.is_owner())`. No client insert/update/delete: rows are written by the server (secret key) and by the functions below.
- Functions, `security definer`, `set search_path = ''`, each starts with `if not private.is_owner() then raise exception … using errcode = '42501'`; `revoke all … from public, anon`; `grant execute … to authenticated`:
  - `public.approve_staff_request(p_user_id uuid)` — requires a request row for that user; inserts `staff (user_id, name, role 'admin')` (`on conflict do nothing`) and deletes the request, in one transaction. The role is fixed inside the function: this path can never create an owner.
  - `public.decline_staff_request(p_user_id uuid)` — sets `status = 'declined'`.
  - `public.remove_staff(p_user_id uuid)` — deletes the staff row only when its role is not `owner`; raises otherwise.
  - `public.list_staff()` — `user_id, name, role, email, created_at` joined with `auth.users` (staff has no email column). Owner only.
- `recordAccessRequest` inserts with `on conflict (user_id) do nothing` and skips the insert when 200 pending rows already exist (anyone with a Google account can reach this path).
- Destructive statements: none. Shipper tests on a branch, checks advisors, applies to production before the code is pushed.

## Design rules

- Admin kit and `adm-*` tokens only; phone-first (stacked rows under `sm`, 44 px targets), three locales, no hard-coded copy.
- States: skeleton (`loading.tsx`), empty waiting list (`EmptyState`: "Nobody is waiting"), action errors as an inline `Notice`, busy state on the pressed button.
- Emails are personal data: owner only, never in logs, analytics or replays (keep the PostHog masking classes the orders screens use).

## Slices

1. **Requests are recorded.** Migration 0008 (table, policy, four functions), `access.ts`, both sign-in paths, the `requested` login notice in three locales. Reviewer: always (auth, RLS, PII).
2. **Team screen.** `/team` page with the three lists and actions, nav row and badge, dictionaries. Reviewer: always.

## Risks and open questions

- Customers share the same Supabase auth: a customer who tries the admin login creates a request. Harmless (one row per account, owner decides), capped at 200 pending.
- Accounts that tried before slice 1 ships are not in the table; they appear after their next attempt.
- `admin` sees dishes and the menu only. If managers need orders, that is the roles work (separate plan); approval here grants `admin`.
- No Telegram ping to the owner on a new request (would put a manager's email into the chat); the sidebar badge is the signal. Easy to add if wanted.
- The Playwright suite runs in demo mode and cannot reach the panel; checked by hand at `http://admin.localhost:5555`.
