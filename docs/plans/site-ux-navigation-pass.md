# Plan · Public site UI/UX and navigation pass (27 Nov 2026)

Asked by Jasurbek on 27 Nov 2026: "improve the overall UI/UX, the page logic and the navigation". Also: "remove
the selection background from all places" and "add a default selection so the user sees something without
typing" (the screenshot shows the calorie calculator with a gold box around the focused height input). The
research behind this is in [customer-site-improvements.md](customer-site-improvements.md).

Out of scope: `/calculator/body` (another thread is building it), phone number and social links (coming
later from the owner), the trial default in the order form and the location pin (both wait for the owner's
answer), and any data model change. No migrations.

## Findings this plan fixes

1. **Double focus box on every text field.** `globals.css` has an unlayered `:focus-visible { outline: 2px
   solid gold }`. Unlayered CSS beats layered rules, so `.field:focus { outline: none }` (in `@layer
   components`) and the Tailwind `outline-none` on inputs never win. Browsers treat every text input focus
   as `:focus-visible`, even a mouse click, so the gold ring shows on every click. In the calculators the
   ring sits on the inner `<input>`, inside the wrapper's own border and short of the unit, so it looks
   misaligned (the owner's screenshot). The same thing happens on the order, login, account and quiz fields.
2. **Calculators start empty.** The result card says "fill in all fields" until six answers are given. The
   leaders (Calo's calculator, Eat Clean Bro) open with a typical person already filled in, so the result
   shows at once and the visitor only adjusts it.
3. **"Programs" has no page.** The header's first link goes to the `#programs` anchor on the home page, and
   `/{locale}/programs` is a 404. The spec's site map has a programs overview. A program page has no way to
   reach the other two programs except through the footer.
4. **No sense of place.** Program, goal and calculator subpages have no breadcrumb, so on a phone the only
   way back is the browser.
5. **Empty sections are shown as content.** With no menu loaded, the home page's "Today's menu", the program
   page's "Menu" block and `/menu` each show a dashed "being prepared" box. On the home and program pages
   that box sits where the proof should be.
6. **No human fallback in the order flow.** Telegram only appears after a failed submit (spec §4 asks for
   "talk to a person" on every step). The success page ends at "we'll contact you", with nothing to do next.

## Design rules

- Brand tokens and fonts from `globals.css` and `docs/01-brand-foundation.md` only. No new colours.
- Focus: text inputs show focus through the field box (border turns forest plus a 3 px soft forest ring via
  `box-shadow`, `color-mix(in srgb, var(--color-forest) 15%, transparent)`). The gold outline stays for
  keyboard focus on buttons, links, chips and radio cards (accessibility). `::selection` (text highlight)
  becomes a light tint, `color-mix(in srgb, var(--color-gold) 35%, transparent)`, with the text colour
  unchanged, so it no longer shows as a solid gold block.
- Every new string exists in `uz`, `uzc` and `ru`, and Uzbek Cyrillic follows the transliteration
  conventions in `src/lib/translit.ts` and the existing `uzc.ts`.
- Mobile first at 375 px. Tap targets are at least 44 px. Pages keep passing the layout smoke tests.

## Slices

### Slice 1 · Focus styling and calculator defaults

- `globals.css`: inputs, selects and textareas (`input:not([type=radio]):not([type=checkbox]):not([type=range])`,
  `select`, `textarea`) get no outline on focus. `.field:focus` and a new `.field:focus-within` rule (for the
  wrapper boxes in the calculators and the phone field) get the forest border plus the soft ring. The
  rule must be unlayered or more specific, so it beats the global `:focus-visible`. Keep the gold
  `:focus-visible` for everything else. Soften `::selection` as above.
- Check every public form: calculator suite (`fields.tsx`, `Calculator.tsx`, BMI, protein, water), order
  form (including the phone prefix box and the textarea), login, account and quiz. None should show a gold
  box on a text field. The invalid red border must still win.
- Defaults (the result shows on first paint, and every value can be changed):
  - Calories and macros (`Calculator.tsx`): woman, 30 years, 165 cm, 68 kg, light activity, lose weight.
  - Protein: 68 kg, light activity, lose weight (match the existing fields).
  - BMI: 165 cm, 68 kg.
  - Water: 68 kg, light activity.
  - Put the defaults in one exported constant in `src/lib/calculator.ts`, so the tools agree.
  - The prefilled numbers look like normal typed values (not placeholders). A small line under the form
    title says "Пример — замените на свои данные" / "Namuna — o‘z ma’lumotlaringizni kiriting" / uzc. This
    makes clear the numbers are an example.
  - Analytics: the existing calculator "result shown" event must not fire for the untouched defaults. Fire
    it only after the visitor changes a field, so the funnel numbers stay honest.

### Slice 2 · Programs overview page and wayfinding

- New `src/app/[locale]/programs/page.tsx`: h1, one-line lead, the three program cards (reuse the home card
  markup as a shared component, don't copy it). Below them is a comparison table: calorie levels, meals per
  day, protein focus, "from" price per day and who it is for, with a "Menu" and a "Choose" link per column.
  On phones the table becomes one stacked card per program. Then come links to the quiz and the calculator
  ("Not sure? Take the 1-minute test"). Add the metadata, the sitemap entry and the `ItemList` structured
  data.
- The header's "Programs" link and the footer's "Programs" label go to `/{locale}/programs`. The current-page
  marker covers `/programs` and every program page.
- `Breadcrumbs` component (server): Home › Programs › BALANCE, Home › Goals › …, Home › Calculator ›
  Protein. Small `label` style above the h1 in the forest hero, plus `BreadcrumbList` JSON-LD. Used on the
  program, goal and calculator subpages and on `/programs`.
- Program page: under the hero add "Other programs", two compact cards linking to the sibling programs,
  plus the existing next-step links (menu, calculator, quiz).

### Slice 3 · Page logic: empty states and the human fallback

- Home: when the featured day has no dishes, don't render "Today's menu". The hero label already handles
  missing totals.
- Program page: the same for its menu block. Keep the "Full 30-day menu" button.
- `/menu`: when the whole program level has no dishes on any day, replace the 30-day picker and the dashed
  box with one calm block: "Меню публикуется перед запуском" plus buttons to choose a plan and to ask in
  Telegram. When some days have dishes, keep today's behaviour.
- Order form: a quiet "Questions? Ask in Telegram" link under each step's heading (on desktop, once under
  the summary). It uses the existing `site.telegram`. No phone number.
- Success page: after the order number, three short next steps. "We'll message you to confirm" (keep the
  current text), "Meanwhile: see the menu" and "Join our Telegram". The second only shows when the menu
  has dishes.

## Update 27 Nov 2026: the calculators merge

The owner asked to merge the calorie, protein, BMI and water tabs into one easy calculator. That replaces
the "calculator defaults" half of slice 1. It is planned as **slice 4** below and waits for the owner's OK.
The focus fix in slice 1 is done (`globals.css`, `body:not(.admin)` rules). Until slice 4, slices 2 and 3
stay out of `src/app/[locale]/calculator/**` and `src/lib/calculator.ts` / `src/lib/body-goal.ts`, so no
breadcrumbs on calculator pages yet.

### Slice 4 · One calculator (after the owner's OK)

Status: owner approved 27 Nov 2026; built 28 Nov 2026, not yet shipped.

- `/{locale}/calculator` becomes the body goal calculator (`calculator/body/BodyGoalCalculator.tsx`, maths
  in `src/lib/body-goal.ts`). It opens prefilled: woman, 30, 165 cm, 68 kg, average build, light activity,
  goal weight from `suggestGoalWeight`. A note says the numbers are an example.
- One results card: daily kcal → protein / fat / carbs (protein grams prominent) → water → BMI with its band
  (add it from height and weight) → fibre → pace to goal → matching program + order button. Vitamins below.
- Remove `CalculatorTabs`, the old calorie calculator and the protein, BMI and water tools. `/calculator/
  {protein,bmi,water,body}` return 308 to `/calculator` (`next.config.ts` redirects, per locale). Sitemap,
  `llms.txt`, header and footer updated. The goal pages and quiz keep linking to `/calculator`.
- Analytics: the result event fires only after the visitor changes something.
- Fold in the live-site review (project file `reviews/live-site-review-2026-11-27.md`, items 4–7, 11):
  pick the truly nearest calorie level (or say "chosen for your goal" when the goal decides); warn when the
  norm is 1,000+ kcal above the largest ration; use one protein rule everywhere (cap at 2.0 g/kg, the same as
  the old protein tool); show "for adults 18+" and the range when an input is out of range instead of the
  silent "fill all fields"; fix the FAQ answer to list sex and goal among the inputs.

## Order and shipping

Pushing waits for the owner's approval of the body calculator commits (`e208498`, `47aecf3`), which are
already on local `main`; any push carries them.


Each slice is built by `builder` and shipped by `shipper` after the gate. No slice touches payments, auth,
RLS or personal data, so the reviewer is optional. Slice 1 runs it anyway because the order and login forms
change. Slice 1 ships first because the owner asked for it directly.
