# Plan · Approved logo everywhere, brand fonts on the alert card

Status: approved for build, 23 Nov 2026.

## Goal

1. The owner supplied the approved logo (square, 1254 × 1254 JPG): a **TQ monogram** — ivory serif letters inside a thin gold ring — above the **TAOMIQ wordmark** (TAOM ivory, IQ gold, wide-set sans capitals) and the gold tagline **PREMIUM DAILY NUTRITION**, on deep forest. Use it everywhere the product shows its identity, replacing the text-only placeholders.
2. The Telegram order alert card uses the brand fonts (Manrope + Noto Serif Display) instead of Noto Sans.

Source file for this work: `/private/tmp/claude-501/-Users-Jasurbek-Shomurodov-Desktop-taomiq/6f5d6a8a-018e-4a9b-9078-76dca6ecd5e1/scratchpad/taomiq-logo-source.jpg`. Copy it into the repo as `src/assets/brand/taomiq-logo.jpg` (the untouched original).

## What "the logo" is in code

There is no vector file, so two forms are used, each where it is strongest:

| Form | Made how | Used for |
|---|---|---|
| **Raster, from the supplied file** | Crops and resizes of the original JPG made with `sharp` by a script (`scripts/build-brand-assets.mjs`), outputs committed | Favicon and app icons, Open Graph / social share image, Organization `logo` in JSON-LD, Telegram alert card header mark |
| **Live lockup, in markup** | `src/components/Logo.tsx`: `Monogram` (ring + TQ) and `Logo` (wordmark), plus a new `Lockup` (monogram + wordmark + optional tagline) drawn with the site's fonts and tokens so it stays sharp at any size and works on light and dark | Header, footer, admin login and sidebar, order success page, 404, home hero |

The live lockup must match the supplied logo's construction: ring stroke weight relative to diameter, TQ in the serif at the same optical size inside the ring, wordmark letter-spacing, IQ in gold, tagline in small wide-tracked gold capitals. Compare side by side with the source and adjust until they read as the same mark. Colours stay on the existing tokens (`--color-forest`, `--color-ivory`, `--color-gold`); do not introduce the JPG's slightly different greens.

Raster outputs (all from the script, deterministic, re-runnable):

- `src/app/icon.png` (512 × 512) and `src/app/apple-icon.png` (180 × 180): the monogram only — crop the ring with a little forest margin, square. Next.js serves these as the favicon and touch icon by file convention; check the convention in `node_modules/next/dist/docs/` for this version, including whether a `favicon.ico` is still wanted.
- `src/app/opengraph-image.jpg` (1200 × 630): the full logo centred on forest, padded (extend the canvas with the logo's own background colour sampled from its corner so no seam shows). Add the alt text file the convention expects. Twitter image can reuse it.
- `public/brand/logo-512.png`: monogram on forest, for JSON-LD and anywhere an absolute URL is needed.
- `src/assets/brand/monogram-alert.png`: monogram crop sized for the alert card header.

## Where it goes (replace every text placeholder)

- **Header** (`SiteChrome.tsx`): small monogram + wordmark; wordmark only below 360 px if space is tight.
- **Footer**: full lockup with tagline (the existing "Premium daily nutrition" label becomes part of the lockup, not a duplicate line).
- **Home hero**: the existing TQ ring graphic uses the same `Monogram` so the two cannot drift apart.
- **Order success, 404 / not-found if present**: lockup above the heading.
- **Admin**: login page (lockup) and panel sidebar/header (monogram + wordmark + "Admin").
- **Metadata**: icons and Open Graph image via file conventions; `Organization.logo` in `src/lib/structured-data.ts` → absolute URL of `public/brand/logo-512.png`.
- **Telegram alert card**: header shows the monogram image (embedded in the SVG as a base64 `<image>`) left of the wordmark.
- README: one line saying where the logo source and the script live.

Accessibility: one accessible name per lockup (`aria-label="TAOMIQ"` on the link/wrapper, decorative parts `aria-hidden`); raster images used as content get `alt="TAOMIQ"`.

## Alert card fonts

- Bundle static TTFs with Latin + Cyrillic: **Manrope** (Regular, SemiBold or Bold, ExtraBold as needed) and **Noto Serif Display** (the weight used for numbers/headline), each with its OFL licence file, in `src/assets/fonts/`. The owner approved downloading these two families from Google Fonts' official sources (the `google/fonts` GitHub repository, or the families' official upstream repositories `sharanda/manrope` and `notofonts`). Download only font and licence files; verify each file is a real TTF and that it contains Cyrillic (render a test string).
- Prefer static instances. Use a variable font only if you prove with a rendered sample that the bundled Pango/Fontconfig selects weights from it correctly — on Linux as well as macOS is what matters, so if in doubt, make static instances.
- Serif for: `№ 1001`, the total. Sans for everything else. The wordmark on the card follows `Logo.tsx` (sans, bold, IQ gold).
- Remove the Noto Sans files and their licence if nothing uses them any more; update `ALERT_FONT_FILES`, the Fontconfig aliases, `outputFileTracingIncludes` and the font-presence assertion.
- `drawableText()` must still match what the new fonts can draw (Manrope covers Latin, Latin Extended incl. `ʻ`, Cyrillic; check `№`, `–`, `·`, `«»`).
- Re-render the sample with `scripts/preview-order-alert.mjs` and check it by eye.

## Slices

1. **Brand assets and logo everywhere** — source JPG, script and outputs, `Logo.tsx` (`Monogram`, `Logo`, `Lockup`), header, footer, hero, success page, admin, icons, Open Graph image, JSON-LD logo.
2. **Alert card** — brand fonts, monogram in the card header, preview re-rendered.

Both slices may be built in one pass; keep them as two commits if practical.

## Constraints

- No new runtime dependency (`sharp` is already there; the asset script runs at author time, not at build time).
- uz/ru (and any later locale) unaffected: the logo carries no translated text; the tagline stays English as in the approved logo.
- Another session has uncommitted SEO work in the main checkout (`src/lib/seo.ts`, page files, layout, sitemap, i18n). This work is built in an isolated worktree from `origin/main`; expect to rebase onto whatever lands first and resolve conflicts in `layout.tsx` / metadata by keeping both sides' intent.

## Risks

- The live lockup is a faithful redraw, not the designer's vector. If a vector (SVG/AI/PDF) of the logo exists, it should replace the redraw — ask the owner.
- JPG source: crops are slightly soft and carry compression artefacts at large sizes; fine for icons and a 1200 px share image, not for print.
- Fonts on Vercel remain proven only by the first production alert; the text fallback stays.
