# Plan · Body goal calculator (body type pictures, sliders, calories, protein, vitamins)

Status: **research done, plan drafted 27 Nov 2026.** Waiting for the owner on one design decision
(§7, Q1: the look of the body type pictures). Slice 1 does not depend on it.

## 0. Owner decision, 27 Nov 2026 (replaces the fixed pictures below)

No grid of pictures. **One animated body** per side ("now" and "goal"), drawn by us in brand style,
following the shapes of the common body-type charts (slim / fit / muscular / overweight) as a visual
reference only; nothing is copied from search results (copyright). The figure **morphs live** as the
height, weight and muscularity sliders move.

- Inputs become: sex, age, height, weight, **muscularity** (4 steps: low, average, athletic,
  muscular), activity; goal weight and goal muscularity.
- Body fat = Deurenberg estimate from BMI/age/sex, lowered by muscularity (because extra muscle raises
  BMI without fat): low +2, average 0, athletic −4, muscular −7 points, held within 5–60%. This
  replaces the picture midpoint and the ±8 cross-check in §3.1–3.2. `BODY_FAT_BANDS` stay only to
  name the shape (lean … heavy) for the figure and the copy.
- Goal body fat = from goal weight, the same height and age and goal muscularity, the same way.
- The figure is a parametric SVG (`src/components/BodyFigure.tsx`): shoulder, chest, waist, hip,
  thigh, arm and neck widths are functions of body fat and muscularity, overall scale from height;
  separate female and male bases; clothed in a sports top and shorts; forest/ivory/gold. Shape
  parameters tween with `requestAnimationFrame` (~250 ms, eased), not CSS `d` transitions (Safari);
  `prefers-reduced-motion` jumps straight to the new shape.

## 1. Goal and user flow

A new tool in the calculator suite, `/[locale]/calculator/body`, tab name "Body goal" (uz: "Tana
maqsadi", uzc: "Тана мақсади", ru: "Цель по фигуре"). The visitor:

1. Picks sex (two chips, as in the other tools).
2. Picks **"Which body is closest to yours now?"** from 5 pictures for that sex.
3. Sets **age, height and weight with sliders** (each slider also shows the number and can be nudged
   with − / + buttons, so it works on phones and with a keyboard).
4. Picks activity (the existing four options).
5. Picks **"Which body do you want?"** from the same 5 pictures (plus the "muscular" picture, §3.1),
   and sets the **goal weight** with a slider. The goal weight slider starts at a suggestion derived
   from the goal picture, which the visitor can move.
6. Gets, live as they change anything:
   - daily calories, protein / fat / carbs, fibre and water;
   - the direction (lose / keep and tone / gain) and a calm pace: "≈ 0.5 kg a week, about 4–5 months
     to 70 kg" — an estimate, never a promise;
   - **key vitamins and minerals** for their sex and age (adult reference intakes), each with 2–3
     everyday local foods that provide it;
   - the TAOMIQ program and calorie level that fits (the existing `recommend()`), with order and menu
     buttons.

The main `/calculator` stays as it is (it ranks for "калькулятор калорий" and feeds the quiz); the new
tool is a richer entry point and links back to it.

## 2. What the research says

| Question | Finding | Consequence |
|---|---|---|
| How do others do it? | Fitness quiz funnels (Ewa, FitCoach, Mad Muscles, BetterMe style) use a two-screen "current body / desired body" pick with illustrations; text-only versions engage less ([Ewa funnel breakdown](https://web2appworld.pages.dev/breakdowns/ewa), [FitCoach](https://screensdesign.com/showcase/home-fitness-coach-fitcoach)) | Same two-step pick, but without their pressure tactics (brand rules: no countdowns, no before/after promises, docs/01 §71) |
| What does a picture tell us? | A picture is a rough body-fat band, not a measurement. Even photo algorithms need DXA calibration ([Majmudar 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9243018), [Shape Up! Adults](https://pmc.ncbi.nlm.nih.gov/articles/PMC7796893)) | Use the picture only as a band midpoint, cross-checked against a height/weight/age formula (§3.2) |
| Which calorie formula? | Mifflin-St Jeor is the best-validated default without body composition ([Frankenfield 2003](https://pubmed.ncbi.nlm.nih.gov/12963943/)). Katch-McArdle uses lean mass and helps for lean or muscular people, but only if body fat is known | Blend: average of Mifflin-St Jeor and Katch-McArdle, with lean mass from the (cross-checked) picture estimate |
| Pace and floors | Leading apps: Mifflin × activity ± goal, pace ≤ 1 kg/week, floors 1,200 kcal (women) / 1,500 kcal (men) (docs/plans/calorie-scanner.md §2.2) | Loss: ~0.5% of body weight a week, deficit ≤ 25%; gain: +10% (≈ 0.25–0.5% a week); floors as above, with a note rather than a silent clamp |
| Protein | 1.6 g/kg/day is where gains in muscle plateau, upper range 2.2 (Morton et al., Br J Sports Med 2018); in a deficit 1.8–2.2 g/kg keeps muscle (Helms et al. 2014) | g/kg of **goal weight** (avoids absurd numbers for heavier people), 1.6 maintain/gain, 2.0 lose or tone, cap 2.2 |
| Vitamins and minerals | Adult reference intakes: US/Canada DRIs (National Academies, the source of the NIH ODS fact sheets) and WHO/FAO. They depend on sex and age, not on the goal | A fixed, cited table by sex and age band; no "personalised" vitamin numbers, no supplement advice |
| Fibre | 14 g per 1,000 kcal (DRI Adequate Intake) | From the calorie result |

## 3. Calculations (all in `src/lib/body-goal.ts`, pure functions)

### 3.1 Body type pictures → body-fat band

Five pictures per sex, ordered lean → heavy. Each has a band and a midpoint used in the maths:

| Key | Picture (men / women) | Men BF % | Women BF % |
|---|---|---|---|
| `lean` | slim, visible definition | 8–12 (10) | 15–19 (17) |
| `fit` | athletic, flat stomach | 13–17 (15) | 20–24 (22) |
| `average` | some softness | 18–24 (21) | 25–31 (28) |
| `soft` | noticeable belly / hips | 25–31 (28) | 32–38 (35) |
| `heavy` | large belly / hips | 32+ (35) | 39+ (42) |

The goal row adds `muscular` (visibly muscular, men 10–14 / women 18–22) which sets a higher lean-mass
target: a surplus when the visitor is already lean, otherwise "lose fat first, high protein".

### 3.2 Cross-check

`bmiEstimate = 1.2 × BMI + 0.23 × age − 10.8 × (male ? 1 : 0) − 5.4` (Deurenberg 1991).
Body fat used = picture midpoint, clamped to `bmiEstimate ± 8` points. So a 120 kg visitor who taps
"lean" still gets sane numbers, and a muscular 95 kg visitor who taps "fit" is not treated as obese.

### 3.3 Energy

- Lean mass `LBM = weight × (1 − BF)`.
- `BMR = ( Mifflin-St Jeor + Katch-McArdle [370 + 21.6 × LBM] ) / 2`.
- `TDEE = BMR × activity factor` (existing 1.2 / 1.375 / 1.55 / 1.725).
- Direction from goal weight vs current (± 1 kg counts as "same"):
  - **lose**: deficit = 0.5% of body weight a week × 7,700 kcal / 7, capped at 25% of TDEE;
  - **tone** (same weight, leaner or muscular goal picture): −10%;
  - **keep**: 0;
  - **gain**: +10% (+15% if goal is `muscular` and current is `lean`/`fit`).
- Floors 1,200 (women) / 1,500 (men); when hit, say so and suggest more activity / a slower pace.
- Weeks to goal = |Δkg| ÷ weekly pace, shown as a range (±20%) in months, only when Δ ≥ 2 kg.

### 3.4 Macros, fibre, water

Protein from §2 on goal weight; fat 0.8–1.0 g/kg of goal weight but at least 25% of calories; carbs the
rest; fibre 14 g / 1,000 kcal; water = existing `waterNeed()`.

### 3.5 Vitamins and minerals (adults, per day)

Shown as a compact list, each with local food sources. Values: DRIs (RDA, or AI where marked *).
Age bands: 18–30, 31–50, 51–70, 71+ (the calculator accepts 18–80).

| Nutrient | Men | Women | Changes with age | Everyday sources (Uzbek table) |
|---|---|---|---|---|
| Vitamin A | 900 µg | 700 µg | — | carrots (osh!), pumpkin, eggs, liver |
| Vitamin C | 90 mg | 75 mg | — | bell pepper, greens, pomegranate, citrus |
| Vitamin D | 15 µg | 15 µg | 20 µg from 71 | sun, eggs, fish |
| Vitamin E | 15 mg | 15 mg | — | sunflower seeds, walnuts, cottonseed/sunflower oil |
| Vitamin K* | 120 µg | 90 µg | — | dill, parsley, cabbage |
| Vitamin B12 | 2.4 µg | 2.4 µg | — | beef, lamb, eggs, qatiq |
| Folate | 400 µg | 400 µg | — | mung beans (mosh), chickpeas, greens |
| Calcium | 1,000 mg | 1,000 mg | women 1,200 from 51, men from 71 | qatiq, suzma, cheese, kurt |
| Iron | 8 mg | 18 mg | women 8 from 51 | beef, liver, mung beans, lentils |
| Magnesium | 400 / 420 mg | 310 / 320 mg | higher from 31 | nuts, buckwheat, beans |
| Zinc | 11 mg | 8 mg | — | beef, lamb, pumpkin seeds |
| Potassium* | 3,400 mg | 2,600 mg | — | apricots / dried apricots, potatoes, beans |
| Sodium | under 2,300 mg | under 2,300 mg | — | (a limit: salt, bread, pickles) |
| Iodine | 150 µg | 150 µg | — | iodised salt |

Values are copied in from the National Academies DRI summary tables and checked by the reviewer
against them; no number is invented by the app.

## 4. Architecture

- **No database, no migration, no API.** Everything runs in the browser from `src/lib/body-goal.ts`;
  the page server component only loads the programme catalogue via the existing
  `getCalculatorPrograms()`.
- Route: `src/app/[locale]/calculator/body/page.tsx` + `BodyGoalCalculator.tsx` (client).
- Shared: `Option`, `ToolLayout`, `CalculatorHero`, `CalculatorHow` from `../fields` and `../suite`;
  `CALCULATOR_TOOLS` gains `"body"` (first tool tab after Calories). New shared components in
  `fields.tsx`: `SliderField` (native `<input type="range">` styled with brand tokens, value bubble,
  − / + buttons, `aria-valuetext` with the unit) and `BodyTypePicker` (radio group of pictures).
- Pictures: `src/components/body-types/` (see §7 Q1 for the format).
- Copy in `src/i18n/{uz,uzc,ru}.ts` under `calcTools.body`.
- Analytics: `calculator_used` with `{ tool: "body", direction }` once per visit, as the others.
- SEO: page metadata, sitemap entry, breadcrumb JSON-LD, hreflang through `pageMetadata` (as the
  other tools). Seed keywords: "калькулятор КБЖУ по фигуре", "сколько белка нужно", "vitaminlar
  kunlik me'yori".

## 5. Design rules

- Mobile first: one column; pictures in a horizontally scrollable row of 5 (≈ 96 px wide each) with
  the selected one in forest with a gold ring; from md, all 5 in one row. The result card is the forest
  card from `ToolLayout`, with a sticky mini bar on phones like the main calculator.
- Sliders: forest track, gold thumb, 44 px touch target, number shown in Noto Serif Display.
- States: empty (card says what to pick), partial (result appears once sex, current picture, age,
  height, weight and activity are set; goal fields refine it), floor reached (note), catalogue
  unavailable (Telegram button, as now).
- Tone: calm, non-medical. Footer note reuses `calculator.disclaimer`, plus one line: "Pictures are a
  rough guide; the numbers are reference values for healthy adults, not a diet prescription.
  Pregnancy, illness or medication: ask a doctor."
- All copy in uz, uzc and ru; brand tokens and fonts only.

## 6. Slices

1. **Logic.** `src/lib/body-goal.ts`: body types and bands, cross-check, BMR blend, direction, pace and
   timeline, macros, fibre, DRI table with age bands. Pure, no UI. Ships without any visible change.
2. **Page with interim pictures.** Route, tab, sliders, picker, result card (calories, macros, fibre,
   water, pace, program), copy in three locales, metadata, sitemap, how-it-works steps. Uses the
   picture style chosen in §7 Q1 (interim brand SVG silhouettes if the owner picks that).
3. **Vitamins and minerals block** with local food sources, in the result area under the card
   (full width on phones, below the form on desktop).
4. **Final pictures** swapped in, if the owner chooses commissioned or generated illustrations.
5. **Links in**: a card on the main calculator result ("Want numbers for your goal body?"), the quiz
   result and the homepage calculator teaser; analytics event.

## 7. Risks and open questions

- **Q1 (owner): the look of the pictures.** Options:
  a) **Brand SVG silhouettes** drawn in code (forest/ivory/gold, clothed in sportswear): consistent,
     tiny, ship this week, easy to tweak; less "wow" than illustrations. *Recommended to start.*
  b) **Commissioned illustrations** (a freelance illustrator, ~11 images per sex style sheet):
     best look, costs money and takes 1–2 weeks.
  c) **AI-generated illustrations**, retouched for consistency: fast, but keeping 11 bodies
     consistent is hard and the licence must be clean.
  Photos of real people are ruled out (consent, and brand rules against before/after imagery).
  All options keep figures clothed (sports top / shorts), which suits the local audience.
- **Q2 (owner): show the "≈ N months to goal" line?** It is useful, but close to a promise. Default:
  show it as a range with "at a steady pace", only for goals within a healthy BMI.
- Goal weight below BMI 18.5: the slider stops at the BMI 18.5 weight and says why.
- Health-adjacent numbers: every formula is cited in the "how we calculate" section; no supplement or
  medical advice; adults 18–80 only.
