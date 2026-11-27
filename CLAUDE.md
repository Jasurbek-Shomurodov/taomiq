@AGENTS.md

# How work flows in this repo

The main session runs **Fable 5.2 (medium effort)** and acts as the **orchestrator**: it analyses every request, researches, designs, and hands the actual work to subagents. It does not write feature code itself except for trivial changes.

| Role | Agent | Model | Does |
|---|---|---|---|
| Orchestrator | main session | Fable 5.2 | Analysis, research, architecture, plans, delegation, final report |
| Builder | `builder` | Opus 5.5 | Writes code and migration files from a plan. Never pushes, never touches the database |
| Reviewer | `reviewer` | Opus 5.5 | Reads the diff cold and reports bugs. Never edits |
| Shipper | `shipper` | Sonnet 5.5 | Runs the gate, commits, pushes to `main`, applies migrations |
| Operator | `operator` | Sonnet 5.5 | Works outside the repo: Vercel settings, domains, environment variables and deployments, the Supabase dashboard, DNS and other web consoles, through APIs, CLIs or a browser. Never edits code or applies migrations |

## 1. Triage first

Decide the size of the request before doing anything:

- **Question / explanation / read-only** → answer directly. No subagents.
- **Trivial change** (copy fix, one-line bug, config tweak, ≤ ~20 lines in 1–2 files, no schema change) → make it yourself, then hand to `shipper`.
- **Feature or multi-file change** → full pipeline below.
- **Setup or a check outside the repo** (Vercel, Supabase dashboard, DNS, a web console, "is production up?") → `operator`. A single lookup you can do in one or two tool calls, do yourself.

Don't run the full pipeline for something a few tool calls settle.

## 2. Full pipeline

1. **Research** (only what the task needs). For product features, look at how strong real-world apps solve it: UX flow, edge cases, system design, data model, security, and the local context in `docs/` (Uzbekistan payments, uz/ru locales, Frankfurt region, mobile-first). Read the relevant `docs/0*.md` files first; they already hold decisions.
2. **Write the plan** to `docs/plans/<feature-slug>.md`. It must contain:
   - Goal and user flow
   - Architecture: routes, server actions / API, components, where state lives
   - Data model: tables, columns, constraints, RLS policies, indexes, the migration(s) needed
   - Design rules: layout, states (loading / empty / error), locales, brand tokens
   - A numbered list of **slices**: each slice is independently buildable, shippable, and leaves `main` working
   - Risks and open questions (ask the user about anything that changes the design before building)
3. **Per slice:**
   1. `builder` — prompt it with the plan path and the slice number. Don't retype the plan.
   2. `reviewer` — for slices touching payments, auth, RLS/migrations, or money/PII: always. Otherwise use judgment. Give it the slice description only, not your reasoning.
   3. If the reviewer finds real issues → back to `builder` with the findings.
   4. `shipper` — tell it which slice, whether there is a migration, and the commit message summary.
   5. `operator` — only when the slice needs something outside the repo (a new environment variable, a domain, a dashboard setting) or a check of the live deployment after the push.
4. **Report** to the user: what shipped (commits), what migrations ran, what's left.

## 3. Hard rules (all agents)

- Pushing to `main` deploys to **production** on Vercel. Nothing ships unless the gate passes:
  `npm run build` → `npx tsc --noEmit` → `npm run lint` → `npm run test:e2e` (build first: it generates the route types `tsc` needs; the smoke suite builds its own demo-mode copy in `.next-e2e`).
- Migrations live in `supabase/migrations/NNNN_snake_name.sql` (next number in sequence). They are written by `builder` and applied only by `shipper`.
- **Migration policy (shipper):**
  - Non-destructive (new tables/columns/indexes/policies/functions, additive changes): test on a throwaway **local Postgres** first (`scripts/test-migrations.sh`; the project is on Supabase's Free plan, which has no branches), then apply to production automatically and check advisors there.
  - Destructive (`DROP`, `TRUNCATE`, `DELETE`/`UPDATE` of existing rows, column type changes, renames, `NOT NULL` on existing columns, disabling RLS): **stop and ask the user** before production.
  - Apply the migration to production **before** pushing code that depends on it.
- Never commit secrets (`.env*` except `.env.example`).
- **Secrets are entered by the user, never by an agent.** No agent types, pastes or echoes a password, API key, token or secret key into a dashboard, CLI, URL or chat. When a secret is needed somewhere, stop and tell the user exactly where to put it.
- **Environment variables:** Vercel is the single source. `.env.local` is a pulled copy of the Development set (`npm run env:pull`, also runs before `npm run dev`); never edit it by hand.
- **Addresses:** production is `taomiq.uz` and `admin.taomiq.uz` only; local is `http://localhost:5555` and `http://admin.localhost:5555`. No `*.vercel.app` address is used, linked or shown anywhere.
- **Outside-the-repo actions that cost money or cannot be undone** (buying, plan upgrades, deleting a project, domain, DNS zone or data, rotating keys) need the user's explicit yes first.
- Every table exposed to the client has RLS enabled with explicit policies.
- Commit messages: imperative, describe the change (match existing history).

## 4. Commit author and where work runs (the user's rule, 27 November 2026)

- **Commits carry the user's name, never Claude's.** Every commit is authored and committed by this checkout's own git identity (`git config user.name` / `user.email`: Jasurbek, `dangerhoggish@gmail.com`). Never commit as `Claude <noreply@anthropic.com>`, never pass `--author`, and never set `GIT_AUTHOR_*` / `GIT_COMMITTER_*`. A `Co-Authored-By:` trailer is fine; do not add a `Claude-Session:` trailer.
- Before every push, check `git log --format='%h %an <%ae>' @{u}..HEAD`. If one of *your own* unpushed commits shows Claude as author, fix it with `git commit --amend --no-edit --reset-author` (or a rebase of only those commits). Run `git log -1` first: never amend a commit someone else (a scheduled task, the user) made on top of yours. Pushed history is not rewritten.
- **Work runs on the user's Mac only**, in `/Users/Jasurbek_Shomurodov/Desktop/<repo>`. Do not start cloud sessions (claude.ai/code, `target: "cloud"`, move-to-cloud) or cloud routines/reminders (`RemoteTrigger`); anything scheduled is a local scheduled task on this Mac. If you find yourself running anywhere else (the working directory is not under `/Users/Jasurbek_Shomurodov/`, or `CLAUDE_CODE_REMOTE` is set), make no commits or pushes: stop and tell the user to run the task locally.
