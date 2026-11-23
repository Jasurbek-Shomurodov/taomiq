# Plan · Motion and mobile UX

## Goal

Make the public site feel alive and effortless on a phone without breaking the brand's "calm premium" rule ([04-website-spec.md](../04-website-spec.md) §1: no timers, pop-ups or flashing banners) or its speed target (LCP < 2.5 s on 4G Android). Content stays server-rendered and visible without JavaScript.

User flow is unchanged. What changes is how each screen responds: pages cross-fade, sections rise in as they scroll into view, controls react to touch, the phone always has the primary action within thumb reach, and the menu, calculator and order form give immediate feedback.

## Architecture

**CSS-first, zero new dependencies.** No `motion` library: nothing here needs springs or drag physics.

| Need | Technique |
|---|---|
| Route and same-route transitions | React 19.3 `<ViewTransition>` + `<Link transitionTypes>`. Works in Next 16.4 with no flag (`node_modules/next/dist/docs/01-app/02-guides/view-transitions.md` — read it before slice 3) |
| Scroll reveals | `animation-timeline: view()` inside `@supports (animation-timeline: view())` and `@media (prefers-reduced-motion: no-preference)`. Unsupported browsers show static content |
| Sheet, error and result entrances | `@starting-style` + `transition-behavior: allow-discrete`; native `<dialog>` for the sheet |
| FAQ height | `details::details-content` + `interpolate-size: allow-keywords`; snaps open where unsupported |
| Press feedback | `:active { scale: .97 }` |
| Count-up | one `useCountUp` hook on `requestAnimationFrame` |

Rules that every slice follows:

- **Never `opacity: 0` as a base state.** Hidden states live only in keyframe `from` blocks under `@supports` + `no-preference`. HTML is visible without JS or modern CSS.
- **Never fade the hero h1 or the first dish image from 0** (LCP). They may translate; opacity stays 1.
- Animate `transform` and `opacity` only. Reserve space for anything fixed or late (CLS).
- Nothing loops (skeleton pulse excepted), nothing bounces or overshoots, maximum travel 24 px, no parallax, no auto-carousels, no horizontal page slides (they fight the iOS edge-swipe).
- One global `prefers-reduced-motion: reduce` block zeroes animation and view-transition durations; `scroll-behavior: smooth` is scoped to `no-preference`. JS-driven motion (count-up, step change) checks `matchMedia`.
- View transitions: `default="none"` on every named `<ViewTransition>`; directional wrapper lives in each `page.tsx`, not the layout; named elements limited to header, day indicator and program title; `::view-transition { pointer-events: none }`; every transition ≤ 400 ms.
- No `window` reads during render (hydration).

## Motion tokens (added to `@theme` in `src/app/globals.css`)

```css
--duration-instant: 100ms;  /* press */
--duration-fast: 160ms;     /* hover, colour, exit */
--duration-base: 240ms;     /* enter, chips, errors */
--duration-slow: 400ms;     /* sheet, shared morph, reveal */
--duration-slower: 700ms;   /* count-up, macro bars */
--ease-out-calm: cubic-bezier(0.22, 1, 0.36, 1);
--ease-in-out-calm: cubic-bezier(0.65, 0, 0.35, 1);
--ease-exit: cubic-bezier(0.4, 0, 1, 1);
--distance-xs: 4px; --distance-sm: 12px; --distance-md: 24px;
--animate-rise: rise var(--duration-slow) var(--ease-out-calm) both;
--animate-fade: fade var(--duration-base) var(--ease-out-calm) both;
```

## Data model

None. No migrations.

## Design rules

- Mobile first at 375 px. Tap targets ≥ 44 px. Inputs ≥ 16 px font (iOS zooms the page below that).
- Brand tokens only (Deep Forest, Ivory, gold); serif headings.
- Both locales: every new label goes into `src/i18n/uz.ts` and `src/i18n/ru.ts`.
- States: skeletons match the final geometry; pending buttons keep their width.

## Slices

### 1. Motion foundation and touch polish (S)

Files: `globals.css`, `[locale]/layout.tsx`, `[locale]/page.tsx`, `SiteChrome.tsx`, `LocaleSwitch.tsx`.

- Tokens, `rise`/`fade` keyframes, reduced-motion block, scoped smooth scroll.
- `.reveal` utility (fade + 24 px rise, `animation-range: entry 0% entry 35%`) on home section h2s, how-it-works steps, program cards, included items.
- Press states on `.btn`, chips, radio cards (0.97, 100 ms in / 160 ms out); `touch-action: manipulation`; `-webkit-tap-highlight-color: transparent`.
- Hero entrance: eyebrow, h1, lead, CTAs, price line `rise` 12 px / 400 ms staggered 60 ms (h1 transform only). CTAs full-width stacked on mobile.
- FAQ: animated height 240 ms; summary min-height 56 px.
- `.field { font-size: 1rem }`; `viewport.viewportFit = "cover"`; locale pills and header links padded to ≥ 40–44 px.

### 2. Mobile navigation and persistent call to action (M)

New: `src/components/MobileNav.tsx`, `src/components/MobileCtaBar.tsx`. Touches `SiteChrome.tsx`, `layout.tsx`, i18n, and home / menu / program / delivery pages.

- Header becomes one 56 px row on phones: logo, locale switch, 44 px menu button. The scrolling text-link row is removed.
- Menu opens as a bottom sheet (`<dialog>`, `rounded-t-3xl`): rises in 400 ms, backdrop fades 240 ms, exit 160 ms. 56 px serif rows, Telegram and locale at the bottom. Links are in the server HTML. Closes on navigation and on backdrop tap.
- Sticky bottom bar, `md:hidden`: "from X so'm/day" on the left, gold "Choose plan" (48 px) on the right, `pb-[max(.75rem,env(safe-area-inset-bottom))]`. Hidden while the page's own hero CTA is on screen (sentinel + `animation-timeline: view()`; stays visible where unsupported). Not rendered on `/order` or `/calculator`. `main` gets matching bottom padding.

### 3. Route and shared-element transitions (S–M)

New: `src/components/PageTransition.tsx`. Touches every public `page.tsx`, `SiteChrome.tsx`, `globals.css`, home and program pages.

- Page change: old content fades out 160 ms, new fades in 240 ms with a 12 px rise. Header is named and does not animate.
- Program name on the home card morphs into the program page h1 (400 ms).
- `searchParams`-driven parts (menu browser, order loader) use the Suspense-reveal pattern, not morphs.

### 4. Menu and program pages on mobile (M)

New: `src/components/DayPicker.tsx`, a `MenuSkeleton`. Touches `menu/page.tsx`, `MenuDay.tsx`, `programs/[slug]/page.tsx`, `[locale]/page.tsx`.

- Day picker: 44 px circles, `snap-x`, edge fades, active day centred on mount, gold indicator glides between days, previous/next-day buttons under the dish list. Days stay real `<Link scroll={false}>`.
- Day content cross-fades (240 ms); skeleton matches chips row + day row + three cards.
- Dish cards on mobile: 112 px square image left, text right. Stagger 40 ms, max 6. First image `loading="eager"` + `fetchPriority="high"`.
- Day totals: macro bars animate width (700 ms) when in view.
- Program price table on mobile: one card per calorie level with a duration list and a full-width order button; table stays from `md:`.
- Home program cards on mobile: snap scroller, cards at 85 % width, CSS dots, whole card is a link.

### 5a. Calculator feedback (S–M)

New: `src/lib/use-count-up.ts`. Touches `Calculator.tsx`.

- kcal counts from previous to new value in 700 ms (tabular-nums; `aria-live` announces the final value only).
- Three macro bars with a 700 ms width transition; result card enters with fade + 12 px rise.
- Sticky bottom mini bar on mobile once a result exists: "≈ 1 850 kcal · Balance / 1800" + Order button.

### 5b. Stepped order form on mobile (L)

New: `order/StepProgress.tsx`. Touches `OrderForm.tsx`, `order/success/page.tsx`, `lib/order/rules.ts` (field → step map), i18n (Next / Back).

- One `<form>`, same state. On mobile one of three steps is shown (Plan, Delivery, Contact); inactive steps are `hidden` so values still submit. Desktop keeps the single page.
- Three-segment progress bar, gold fill animates `scaleX` 400 ms. Sticky bar button is "Next" until the last step. Per-step validation through `validateOrder`'s field map. A server error jumps to the step that owns the first invalid field.
- Field errors enter with a 240 ms fade; one 4 px nudge on the first invalid field, no repeating shake.
- Pending: spinner replaces the label at fixed width. Success page: SVG check draws in 400 ms, order number rises in.

Reviewer required for 5b (it is the conversion path and carries personal data).

## Risks

- **Older iOS / in-app browsers** (Telegram, Instagram are major traffic sources): scroll-driven animations and view transitions may be missing — everything is gated and falls back to static. Must be checked on a real device after slices 1–3.
- **`backdrop-blur` header** can flicker when snapshotted by a view transition; switch to solid `bg-forest` during transitions if seen.
- **Stepped order (5b)** is the riskiest change; ship last and verify hidden inputs submit and server-error focus still works.
- **CLS** from the fixed CTA bar and skeletons — reserve space.

## Open questions

1. The spec describes five order steps including phone OTP and payment; the form today has three sections. This plan steps the existing three. OTP and payment remain for the ordering phase.
2. Bottom tab bar vs single sticky call to action: this plan chooses the single CTA (one conversion goal). Say so if you prefer tabs.
