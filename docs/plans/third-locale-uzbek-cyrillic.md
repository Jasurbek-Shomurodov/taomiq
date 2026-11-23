# Plan · Three languages: Uzbek (Latin), Uzbek (Cyrillic), Russian

Status: approved for build, 23 Nov 2026. Owner's decisions: the third language is **Uzbek in Cyrillic script**; the **admin panel is also available in all three**; the migration below is **approved for production**, including the replacement of the `orders.locale` check.

This reverses "Uzbek Cyrillic: out of scope for v1" in [04-website-spec.md](../04-website-spec.md) §12 — update that line and [08-open-questions.md](../08-open-questions.md) #9 as part of slice 1.

## Goal

Every public page and the whole back office work in three languages with equal quality. A visitor or staff member picks the language once and it sticks. Kitchen staff do not have to type every dish three times.

## Locale model

| Code (URL segment, DB suffix, dictionary file) | Language | `<html lang>` / hreflang | Switch label |
|---|---|---|---|
| `uz` | Uzbek, Latin (default) | `uz-Latn` | `Oʻz` |
| `uzc` | Uzbek, Cyrillic | `uz-Cyrl` | `Ўз` |
| `ru` | Russian | `ru` | `Рус` |

- `src/i18n/config.ts`: `locales = ["uz", "uzc", "ru"]`, plus a `htmlLang` map and a `localeLabel` map. Everything that lists locales (static params, sitemap, hreflang alternates, the switch, `isLocale`) derives from this array — no second hard-coded list anywhere. Grep for `"ru"` / `"uz"` literals and for `_uz` / `_ru` to find every branch.
- `x-default` hreflang stays `uz`.
- Proxy language detection: `Accept-Language` cannot tell the two Uzbek scripts apart, so `uz…` → `uz` unless the tag says `uz-Cyrl`; `ru…` → `ru`; otherwise `uz`. A visitor's explicit choice is not overridden on later visits (the path carries it).
- Plurals: Uzbek Cyrillic repeats one form, like Latin Uzbek. Check `plural()` callers.

## Texts

### Interface dictionary

`src/i18n/uzc.ts`, same shape as `uz.ts` (the `Dictionary` type must make a missing key a compile error for all three). Write real Uzbek Cyrillic, not a mechanical conversion: start from the Latin text, convert, then correct loanwords and proper nouns. Brand and program names stay Latin (`TAOMIQ`, `LIGHT`, `BALANCE`, `PROTEIN`), as do `Payme`, `Click`, `Telegram`, `Instagram`. Units follow Uzbek Cyrillic usage (`ккал`, `сўм`, `г`).

### Database content (programs, dishes)

New columns, all `text not null default ''`:

- `programs.tagline_uzc`, `programs.description_uzc`
- `dishes.name_uzc`, `dishes.ingredients_uzc`

Reading rule, in one helper used everywhere (`localized(row, "name", locale)` in `src/lib/data/…`): for `uzc`, use the `_uzc` value if it is non-empty, **otherwise transliterate the `_uz` value** on the fly. So the site is complete in Cyrillic from day one and staff only correct the cases the converter gets wrong.

### Transliteration (`src/lib/translit.ts`)

Latin → Cyrillic for Uzbek, pure function, no dependency:

- Digraphs and modifier letters first: `oʻ o' o‘ → ў`, `gʻ g' g‘ → ғ`, `sh → ш`, `ch → ч`, `ng → нг`, `yo → ё`, `yu → ю`, `ya → я`, `ye → е`, `ts → ц` (inside a word; `с` at the start is not assumed).
- `e` → `э` at the start of a word and after a vowel, `е` elsewhere. `ʼ ' ’` (tutuq belgisi, when not part of `oʻ`/`gʻ`) → `ъ`.
- Single letters by table (`q → қ`, `h → ҳ`, `x → х`, `j → ж`, `v → в`, …). Case preserved, including all-caps words and Title Case digraphs (`Sh → Ш`, `SH → Ш`).
- A token is left untouched when it is a protected word (brand, program names, payment and social names — one exported list), all digits/punctuation, or a unit handled by a small map (`kkal → ккал`, `soʻm → сўм`, `g → г`).
- Include a table of at least 40 input/expected pairs covering every rule above, runnable with a plain `node` script (`scripts/check-translit.mjs`) that exits non-zero on a mismatch. There is no test runner in this repo; do not add one.

## Data model — migration `0005_uzbek_cyrillic.sql`

1. `alter table … add column` for the four columns above (additive).
2. `orders.locale`: replace the check `in ('uz','ru')` with `in ('uz','uzc','ru')`. This is `drop constraint` + `add constraint`; mark it at the top of the file as **owner-approved** (23 Nov 2026). No rows change. Find the constraint's real name from `0004_orders.sql`.
3. `create or replace function public.submit_order(…)`: same signature and body as in `0004`, accepting `uzc` as a locale. Re-state the `revoke … from public, anon, authenticated` and `grant … to service_role` so privileges cannot regress.
4. A column on `staff` for the admin language: `locale text not null default 'ru' check (locale in ('uz','uzc','ru'))` (additive). RLS: a staff member may update **only their own** `locale` — add a column-level `grant update (locale)` and an update policy `user_id = (select auth.uid())` with the same `with check`; nothing else on `staff` becomes writable by non-owners. If `staff` already has an update policy for owners, keep it as is.

No data backfill is needed (fallback transliteration covers empty `_uzc`).

## Back office

- **Content fields.** Dish and program forms gain the Cyrillic fields next to the Latin ones, with a "Fill from Latin" button that runs the same `translit()` in the browser and lets staff edit the result. Empty is allowed (site falls back). Server actions accept and validate the new fields with the same limits as their siblings.
- **Interface language.** All hard-coded Russian in `src/app/admin/**`, `src/lib/admin/**` (labels, buttons, empty states, error and success messages returned by server actions, order status names, allergen names if they are admin-only) moves into admin dictionaries `src/i18n/admin/{ru,uz,uzc}.ts` with one shared type. Russian remains the reference text.
- **Choosing it.** A three-way switch in the admin header. The choice is saved on the staff row (`staff.locale`) through a server action and read in `requireStaff()`, so it follows the person across devices; the login page (no session yet) uses a cookie `admin_locale`, defaulting to Russian. Admin URLs do not change.
- Dates, numbers and money in the admin format per the chosen language, in `Asia/Tashkent`.
- The Telegram order card stays Russian (one shared staff chat); its "Язык сайта" line shows the customer's language with the new value named `узбекский (кириллица)`.

## Design rules

- The language switch shows three compact options; at 375 px it must not push the "Choose plan" button off the header (collapse to a menu if needed).
- Cyrillic Uzbek uses letters `ў қ ғ ҳ` — confirm the site fonts (Manrope, Noto Serif Display) and the alert-card fonts render them; if a font lacks one, say so in the report rather than shipping tofu.
- No raw keys, no half-translated screens, no Latin leaking into Cyrillic pages except the protected words.
- Legal note: the public offer must exist in Uzbek ([08-open-questions.md](../08-open-questions.md) B); either script satisfies "in Uzbek", this plan does not write the offer.

## Slices

1. **Locale plumbing, public site, migration.** Config, proxy, switch, dictionaries (`uzc.ts`), `translit.ts` + check script, `localized()` helper and every public page/component that reads `_uz`/`_ru`, metadata/hreflang/sitemap/JSON-LD language tags, order form and action (locale `uzc` end to end), privacy/calculator/delivery pages, migration `0005`, docs updates. Leaves `main` working: all three languages render; admin still Russian.
2. **Back-office content fields.** Cyrillic fields with "Fill from Latin" in dish and program forms, actions and queries.
3. **Back-office interface in three languages.** Admin dictionaries, `staff.locale` wiring, switch, every admin screen and server-action message.

Reviewer: slice 1 always (migration, `submit_order`, RLS on `staff`). Slices 2–3 by judgment (server actions touched).

## Risks and open questions

- **Uzbek text quality.** Both Uzbek dictionaries are drafted without a native editor; Cyrillic adds loanword spelling choices. A native check is needed before launch.
- **Transliteration is a fallback, not truth.** Russian loanwords and names (`sentyabr → сентябрь` vs converter output `сентябр`) will be wrong sometimes; that is what the `_uzc` override fields are for.
- **Search engines.** Two Uzbek versions of each page are near-duplicates in different scripts; correct `uz-Latn` / `uz-Cyrl` hreflang pairs are what keeps them from competing.
- **Concurrent work.** Another session has uncommitted SEO changes touching the same pages, dictionaries, sitemap and proxy. Build in an isolated worktree from the latest `origin/main`; whoever lands second rebases and must add any new dictionary keys to `uzc.ts`.
