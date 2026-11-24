# Plan · Premium polish (Taste Skill audit)

Status: planned 24 Nov 2026. Source: an audit of every public page at 390 and 1440 px (ru, dev data and the demo build), checked against the rules of [Taste Skill](https://github.com/Leonxlnx/taste-skill) v2.5.1 (`SKILL.md`, `references/motion.md`, `references/copy-tells.md`).

## Decision: borrow rules, not the kit

Taste Skill is an agent rule set plus a static-HTML starter kit. Its kit deals its own palette, fonts and hero layouts, and fills pages with licensed stock photos. All of that conflicts with [01-brand-foundation.md](../01-brand-foundation.md): fixed tokens, Noto Serif Display + Manrope, and real dish photos only. **Nothing from the repo is installed, copied or run.** Below are the rules we adopt, rewritten in this project's own tokens and components:

| Taste rule | Adopted as |
|---|---|
| Every visual renders and there are no empty grounds | Dish cards without a photo drop the empty frame (slice 2). The hero and program pages get a real visual instead of a decorative ring or an empty half (slice 3) |
| Hover layer: linked card lifts 2px, photo zooms 1.02–1.03 inside its frame, buttons step 1px and press, links draw their underline, 2px focus ring | Slice 1, using the existing duration and easing tokens |
| Current page marked with a 2px bar under its nav word | Slice 1 |
| Show the real product, not a placeholder | The packaging label (`TAOMIQ BALANCE / 1800`, `520 ккал · Б 38 · Ж 17 · У 54`) is the brand's own product graphic (brandbook) and becomes the hero visual (slice 3) |
| Check in a real browser at several widths before shipping | Layout smoke tests in the gate (slice 4) |

Not adopted: dealt palettes and fonts, stock photos, one section per screen (the site's sections are content-sized, which suits a menu), captions rule (we have none), effects and shaders (Taste itself bans them for food and places), and the copy linter (Russian and Uzbek use the em dash grammatically, so its main English tells don't apply). **Kept despite Taste:** the scroll reveals from [motion-mobile-ux.md](motion-mobile-ux.md). Taste bans "stock reveals", but they were an approved decision here, so changing that is an open question below.

## Audit findings

| # | Where | Finding | Severity |
|---|---|---|---|
| 1 | `/menu` (all widths) | **Bug.** On load the document scrolls by ~65–123 px and the "Меню" h1 sits under the sticky header. Cause: `[scroll-initial-target:nearest]` on the active day in `src/components/DayPicker.tsx`. `scroll-initial-target` applies to every scroll container including the viewport, not only the day row. The `useLayoutEffect` there already centres the row | High |
| 2 | Menu, home "Сегодня в меню", program page | A dish without a photo shows a 4:3 ivory box with a faded TQ (`DishPhoto` fallback in `dish-parts.tsx`). Five identical empty frames per day are the least premium thing on the site | High |
| 3 | Home hero, right half | Decorative TQ monogram in concentric rings: a logo where the product should be | Medium |
| 4 | Program page hero (`/programs/[slug]`) without a photo | The right half of the forest hero is empty | Medium |
| 5 | Dish cards | Macros are four pill chips plus a weight chip, which reads busy. The brandbook prescribes a tracked sans data line: `520 ккал · Б 38 · Ж 17 · У 54` | Medium |
| 6 | Site-wide | No hover state on linked cards (home program cards, `ProgramLinks`, dish cards). Buttons only change colour. No focus-visible ring standard. The nav doesn't mark the current page | Medium |
| 7 | Site-wide | Nothing in the gate catches layout regressions such as #1 (scroll on load, horizontal overflow, h1 hidden under the header) | Medium |

Things that are already good and stay: palette and type, section rhythm, the hero entrance and press feedback (`.hero-enter`, `.press`), the day-total macro bar, footer, FAQ.

## Architecture

No new routes, no server actions, no dependencies. CSS goes in `src/app/globals.css`. Components:

| Piece | Where |
|---|---|
| Hover / focus layer (`.lift`, `.zoom`, `.link`, button step, `:focus-visible`) | `globals.css` (unlayered "Motion utilities" block, next to `.press`) |
| Current-page marker | `src/components/SiteChrome.tsx` (nav links; `usePathname` in a small client child if the header is a server component) |
| Dish card data line and no-photo layout | `src/components/dish-parts.tsx`, `src/components/MenuDay.tsx`, `src/components/DishSheet.tsx` |
| Ration label visual | new `src/components/RationLabel.tsx` (server component) |
| Home hero, program hero | `src/app/[locale]/page.tsx`, `src/app/[locale]/programs/[slug]/page.tsx` |
| Layout smoke tests | new `e2e/layout.spec.ts` (runs in the existing `phone` and `desktop` projects against the demo build) |

## Data model

None. No migrations. The label uses data the pages already load: programs and variants (`getPrograms()`), and the day's menu totals where the page already has them.

## Design rules

- Brand tokens only. Gold is never text on ivory or white (fails contrast). On light surfaces gold is a rule, bar or dot.
- Motion numbers, mapped onto the existing tokens:
  - Hover in uses `--duration-fast` (160 ms), out 120 ms, ease `--ease-out-calm`.
  - Linked card: `translate: 0 -2px`, border one step darker (`--color-line` → `color-mix(in srgb, var(--color-forest) 25%, var(--color-line))`), optional shadow `0 12px 24px -12px rgb(24 60 52 / .10)`.
  - Photo: `scale: 1.03` inside its frame (`overflow: hidden`), 600 ms in and 400 ms out. Never an overlay or dimming.
  - Button: 1px up on hover. The existing `:active` scale `.97` stays.
  - Text link: a 1px underline draws left to right (`background-size` on a linear-gradient, so no layout change).
  - Arrow inside a link or card: 3px right.
  - All hover rules sit under `@media (hover: hover) and (pointer: fine)`. Keyboard `:focus-visible` shows the same lifted state. Everything is zeroed by the existing `prefers-reduced-motion: reduce` block.
  - Animate `translate`, `scale`, `opacity` and colours only. Nothing resizes or pushes a neighbour.
- Focus: `:focus-visible { outline: 2px solid var(--color-gold); outline-offset: 2px }` site-wide (public site only; `.admin` keeps `--adm-ring`). On ivory backgrounds gold at 2px is decoration, not text, so it's acceptable. Check it on forest and ivory both.
- Locales: any new label goes into `uz.ts`, `uzc.ts` and `ru.ts`.
- Phones first: check at 390 and 1440, both themes not applicable (the public site has one theme).

## Slices

### Slice 1: Menu scroll fix, hover and focus layer, current page

1. `DayPicker.tsx`: remove `[scroll-initial-target:nearest]`. The layout effect already centres the active day in the row. Verify that `/ru/menu?…&day=24` lands with `scrollY === 0` at 390 and 1440, and that day 24 is centred in the row at 390.
2. `globals.css`: add `.lift` (linked card), `.zoom` (photo frame: the class goes on the frame, and the `img` scales on the frame's hover or on the hover of the nearest `.lift`), `.link` (drawn underline), the `.btn` 1px hover step, the arrow nudge (`.nudge` on the arrow svg/span inside a `.lift` or `.link`), and the public `:focus-visible` ring. Follow the design rules above.
3. Apply: home program cards (`page.tsx` `#programs`) get `.lift` and `.zoom` on the photo frame when there is a photo. `ProgramLinks.tsx` cards get `.lift` and `.nudge` on the arrow. Dish cards in `MenuDay.tsx` get `.lift` (they open the sheet) and `.zoom` on the photo frame. "Все вопросы", "Пройдите тест" and the in-text links in privacy/FAQ answers get `.link`. Footer links get colour plus underline draw.
4. `SiteChrome.tsx`: mark the current section in the desktop nav with `aria-current="page"` and a 2px gold bar 6px under the word, and in the mobile sheet with forest text and a gold dot. `/programs/*` counts as Программы, `/calculator/*` as Калькулятор.

Done when hovering a program card at 1440 lifts it 2px with a darker border, a dish photo zooms inside its frame, Tab shows a gold ring on every control, the nav marks the current page, and nothing moves under reduced motion.

### Slice 2: Dish cards

1. Data line: replace the macro chips in the card with one line in the sans, tracked (`.label` metrics but sentence case for units): `297 ккал · Б 11 · Ж 8 · У 46 · 270 г`, with kcal in forest semibold and the rest in `text-muted`. Keep the badge ("До 350 ккал", "Много белка") as is. Use the same line in `DishSheet.tsx` under the title, and keep the sheet's own detailed macro block.
2. No photo: the card drops the image frame entirely. The meal-type tag ("ЗАВТРАК") moves into the card body above the badge, and the card keeps its border and padding. In a day grid where some dishes have photos and some don't, rows align to the top (no stretched empty space). Cards with a photo are unchanged apart from slice 1's zoom.
3. Remove `DishPhoto`'s monogram fallback if nothing else uses it (check `DishSheet`, home "Сегодня в меню" and the program page).

Done when the demo menu (`/ru/menu?program=balance&kcal=1800&day=1`, where demo dishes have no photos) shows five compact cards with the data line, at 390 and 1440, and a dish with a photo still shows it.

### Slice 3: Ration label as the hero visual

1. New `RationLabel` server component, drawn after the physical package label from the brandbook. It is an ivory card with a hairline gold border and 1.5rem radius. Inside:
   - The TQ monogram, small, top left.
   - `TAOMIQ` and then the program name in the serif, large: `BALANCE`.
   - The tracked sans data line `BALANCE / 1800`.
   - A hairline rule.
   - `5 приёмов пищи · от 255 000 сум в день`.
   - When the page has the day's menu totals, a last line `1798 ккал · Б 132 · Ж 71 · У 168`, else omitted.

   All values come from the program and variant data and are never invented. Props: `program`, `variant`, optional `totals`, `locale`.
2. Home hero: replace the ringed monogram with the label for the BALANCE program's lowest variant (the hero already says "от 215 000"; keep the cheapest-price line in the copy). When that program has `photo_url`, show the photo in a tall rounded frame (4:5, `next/image`, `priority`, `sizes` set) with the label overlapping its lower left corner. Without a photo, the label stands alone, rotated −2° on desktop only (no rotation under reduced motion or on phones). On phones the visual sits under the buttons at full width and at most 320px tall, or is hidden below 390px if it pushes the primary CTA below the first screen (check the 390×844 screenshot: the gold "Выбрать рацион" button must stay on the first screen).
3. Program page hero: the same treatment for that program. The photo plus label when `photo_url` exists, else the label alone in the empty right half (desktop). On phones the label goes under the lead paragraph.
4. LCP: the h1 stays the LCP element without a photo. With a photo, the photo is `priority`. The label animates with the existing `.hero-enter` stagger (translate only, never from opacity 0 for the photo).

Done when the home and program heroes at 1440 have no empty half and no decorative ring, the values on the label match the prices table, and the phone first screen still shows the h1 and the primary button.

### Slice 4: Layout smoke tests in the gate

New `e2e/layout.spec.ts`. It runs in the existing `phone` and `desktop` projects against the demo build. For each of `/ru`, `/ru/menu`, `/ru/menu?program=balance&kcal=1800&day=24`, `/ru/prices`, `/ru/programs/balance`, `/ru/delivery`, `/ru/faq`, `/ru/quiz`, `/ru/calculator`, `/uz`, `/uzc/menu` it checks:
- `window.scrollY === 0` after load (catches finding #1).
- No horizontal overflow: `document.documentElement.scrollWidth <= innerWidth`.
- The page's h1 bottom edge is below the sticky header's bottom edge.
- No `img` with `naturalWidth === 0` after load.
- No console errors.

Keep it fast: one page load per route per project, no screenshots. Done when the suite passes on the fixed code and fails if the `scroll-initial-target` class is put back (check this once locally, then remove the reintroduced class).

## Risks and open questions

- **Scroll reveals.** Taste Skill says nothing should fade or rise in on scroll except one deliberate moment per page. The site uses `.reveal` on sections (approved in motion-mobile-ux). Removing it would make the site calmer and closer to "premium". That's the user's call; this plan leaves it alone.
- **Photos remain the biggest lever.** Real dish and program photos (brandbook launch dependency) will do more for "premium" than any of these slices. Slices 2 and 3 make the no-photo state look intentional and upgrade automatically when photos are uploaded.
- The rotated label is a small flourish. Drop it if it reads as gimmicky in the screenshot review.
