import { bodyMassIndex, calculate, formatDecimal, proteinNeed, recommend, waterNeed } from "../src/lib/calculator";
import { DIRECTION_GOAL, calculateBodyGoal, maxGoalWeight, minGoalWeight, suggestGoalWeight } from "../src/lib/body-goal";
import { GOAL_PAGES, GOAL_PROGRAM } from "../src/lib/goal-pages";
import { demoDurations, demoPrograms } from "../src/lib/data/demo";
import { pricePerDay } from "../src/lib/data/types";
import { defaultLocale, formatSum, htmlLang, localeName, locales, type Locale } from "../src/i18n/config";
import { getDictionary } from "../src/i18n";
import { ANALYTICS_PATH } from "../src/lib/analytics/config";
import { withoutTrailingSlash } from "../src/lib/url-path";
import ru from "../src/i18n/ru";
import uz from "../src/i18n/uz";
import type { Page } from "@playwright/test";
import { expect, test, watchPageProblems } from "./fixtures";

// Tests that loop over the site's languages read them from the app's own config (src/i18n/config.ts),
// so a new locale is covered without editing this file. Single-flow tests below pick one language.

/** The site's radios are visually hidden inside a card-like label: tap the card, as a visitor would. */
async function choose(page: Page, name: string) {
  const radio = page.getByRole("radio", { name });
  await page.locator("label").filter({ has: radio }).click();
  await expect(radio).toBeChecked();
}

/**
 * The first-visit redirect in src/proxy.ts (preferredLocale): the uz or ru tag with the highest
 * q wins (the earlier one on a tie, q=0 never), a uz tag naming the Cyrillic script picks uzc, anything else
 * falls back to the default.
 */
const acceptLanguageCases: { header: string; expected: Locale }[] = [
  { header: "", expected: defaultLocale },
  { header: "en-US,en;q=0.9", expected: defaultLocale },
  { header: "ru-RU,ru;q=0.9,en;q=0.8", expected: "ru" },
  { header: "uz-UZ,uz;q=0.9,ru;q=0.8", expected: "uz" },
  { header: "uz-Cyrl-UZ,uz;q=0.9,ru;q=0.8", expected: "uzc" },
  { header: "en-US,ru;q=0.8,uz;q=0.5", expected: "ru" },
  { header: "ru;q=0.5,uz;q=0.9", expected: "uz" },
  { header: "en;q=0.9, ru;q=0.4, uz-Cyrl;q=0.8", expected: "uzc" },
  { header: "ru;q=0,en", expected: defaultLocale },
  { header: "ru;q=0,uz-Cyrl;q=0.1", expected: "uzc" },
];

test("/ sends visitors to their language, the default locale otherwise", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/${defaultLocale}$`));

  for (const { header, expected } of acceptLanguageCases) {
    for (const [path, target] of [["/", `/${expected}`], ["/menu", `/${expected}/menu`]]) {
      const response = await request.get(path, { headers: { "Accept-Language": header }, maxRedirects: 0 });
      expect(response.status(), `${path} with Accept-Language "${header}"`).toBe(307);
      expect(new URL(response.headers()["location"], "http://localhost").pathname, `${path} with "${header}"`).toBe(target);
    }
  }
});

for (const locale of locales) {
  test(`home page renders in ${locale}`, async ({ page, baseURL }) => {
    const t = getDictionary(locale);
    const problems = watchPageProblems(page, baseURL!);

    const response = await page.goto(`/${locale}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", htmlLang[locale]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(t.hero.title);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();

    await page.waitForLoadState("networkidle");
    expect(problems).toEqual([]);
  });
}

test("the language switch keeps the current page, through every locale and back", async ({ page }) => {
  const [first, ...rest] = locales;
  await page.goto(`/${first}/menu`);

  // Each switch link is named by the language's full name (aria-label), in its own script.
  for (const target of [...rest, first]) {
    const link = page.getByRole("banner").getByRole("link", { name: localeName[target], exact: true });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/${target}/menu$`));
    await expect(page.locator("html")).toHaveAttribute("lang", htmlLang[target]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(getDictionary(target).menu.title);
    await expect(link).toHaveAttribute("aria-current", "true");
  }
});

test("the language switch keeps the query string, also after a same-page day change", async ({ page }) => {
  await page.goto("/uz/menu?day=1");
  // A client-side navigation that changes only the query: the switch must pick up the new one.
  await page
    .getByRole("navigation", { name: uz.menu.day, exact: true })
    .getByRole("link", { name: "2", exact: true })
    .click();
  await expect(page).toHaveURL(/[?&]day=2(&|$)/);
  const search = new URL(page.url()).search;

  await page.getByRole("banner").getByRole("link", { name: localeName.ru, exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/ru/menu" && url.search === search);
  await expect(page.locator("html")).toHaveAttribute("lang", htmlLang.ru);
});

test("menu: choosing another day changes the dishes", async ({ page }) => {
  await page.goto("/uz/menu?day=1");
  const dishes = page.getByRole("main").getByRole("heading", { level: 3 });
  await expect(dishes.first()).toBeVisible();
  const firstDay = await dishes.allTextContents();

  await page
    .getByRole("navigation", { name: uz.menu.day, exact: true })
    .getByRole("link", { name: "2", exact: true })
    .click();
  await expect(page).toHaveURL(/[?&]day=2(&|#|$)/);
  await expect(page.getByText(new RegExp(`· ${uz.menu.day} 2$`))).toBeVisible();
  await expect.poll(() => dishes.allTextContents()).not.toEqual(firstDay);
  await expect(dishes.first()).toBeVisible();
});

test("menu: a dish card opens its detail sheet, which closes back to the card", async ({ page }) => {
  await page.goto("/uz/menu?day=1");
  const main = page.getByRole("main");
  const name = (await main.getByRole("heading", { level: 3 }).first().textContent())!.trim();
  const card = main.getByRole("button", { name, exact: true });

  await card.click();
  const sheet = page.getByRole("dialog", { name });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { level: 2, name })).toBeVisible();
  await expect(sheet.getByText(uz.menu.ingredients, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(card).toBeFocused();

  await card.click();
  await sheet.getByRole("button", { name: uz.nav.close }).click();
  await expect(sheet).toBeHidden();
});

test("program page shows its calorie levels and prices", async ({ page }) => {
  const program = demoPrograms[0];
  await page.goto(`/uz/programs/${program.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(program.name);

  // Phones show one card per level, wider screens a table: check whichever is on screen.
  for (const variant of program.variants) {
    await expect(page.getByText(`${variant.kcal} ${uz.programs.kcal}`).filter({ visible: true }).first()).toBeVisible();
    for (const duration of demoDurations) {
      const perDay = formatSum(pricePerDay(variant.price_per_day, duration.markup_pct));
      await expect(page.getByText(perDay, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    }
  }
});

/** The JSON-LD blocks of a page, parsed (a malformed one fails the test). */
async function jsonLdTypes(page: Page): Promise<string[]> {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  return blocks.map((text) => (JSON.parse(text) as { "@type"?: string })["@type"] ?? "");
}

for (const locale of locales) {
  test(`FAQ page renders in ${locale} and owns the FAQPage data`, async ({ page }) => {
    const t = getDictionary(locale);
    const response = await page.goto(`/${locale}/faq`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.faq.title);
    await expect(page.locator("summary", { hasText: t.faq.items[0].q })).toBeVisible();
    expect(await jsonLdTypes(page)).toEqual(expect.arrayContaining(["FAQPage", "BreadcrumbList"]));

    await page.goto(`/${locale}`);
    expect(await jsonLdTypes(page)).not.toContain("FAQPage");
  });

  test(`prices page renders in ${locale} with every program`, async ({ page }) => {
    const t = getDictionary(locale);
    const response = await page.goto(`/${locale}/prices`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.prices.title);
    for (const program of demoPrograms) {
      await expect(page.getByRole("heading", { level: 2, name: `TAOMIQ ${program.name}` })).toBeVisible();
    }
    // A price cell, computed as the program page and the order form compute it.
    const variant = demoPrograms[0].variants[0];
    const perDay = formatSum(pricePerDay(variant.price_per_day, demoDurations[0].markup_pct));
    await expect(page.getByText(perDay, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    expect(await jsonLdTypes(page)).toEqual(expect.arrayContaining(["ItemList", "BreadcrumbList"]));
  });
}

test("calculator gives a daily norm and a matching program", async ({ page }) => {
  const t = ru.calculator;
  await page.goto("/ru/calculator");

  await choose(page, t.female);
  await page.getByLabel(t.age, { exact: true }).fill("30");
  await page.getByLabel(t.height, { exact: true }).fill("165");
  await page.getByLabel(t.weight, { exact: true }).fill("60");
  await choose(page, t.activities.moderate.title);
  await choose(page, t.goals.maintain.title);

  const result = calculate({ sex: "female", age: 30, height: 165, weight: 60, activity: "moderate", goal: "maintain" });
  const plan = recommend(demoPrograms, result.kcal, "maintain");
  expect(plan).not.toBeNull();

  // The screen-reader summary carries the final numbers (the big figure counts up to them).
  const summary = page.locator('[aria-live="polite"]');
  await expect(summary).toContainText(`${t.resultLabel}: ${formatSum(result.kcal)} ${t.kcal}.`);
  await expect(summary).toContainText(`${t.planLabel}: ${plan!.program.name} ${plan!.variant.kcal}.`);
  await expect(page.getByText(t.planLabel, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: t.order })).toHaveAttribute(
    "href",
    `/ru/order?program=${plan!.program.slug}&kcal=${plan!.variant.kcal}`,
  );
});

test("quiz: three questions lead to a program and a pre-filled order link; Back returns a step", async ({ page }) => {
  const t = ru.quiz;
  const c = ru.calculator;
  await page.goto("/ru/quiz");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.title);

  const next = page.getByRole("button", { name: t.next });
  await expect(next).toBeDisabled();
  await choose(page, c.goals.lose.title);
  await next.click();
  await expect(page.getByRole("heading", { level: 2, name: t.activity })).toBeVisible();
  await expect(page).toHaveURL(/#step-2$/);

  await choose(page, c.activities.light.title);
  await next.click();
  await expect(page.getByRole("heading", { level: 2, name: t.body })).toBeVisible();
  await choose(page, c.female);
  await page.getByLabel(c.age, { exact: true }).fill("35");
  await page.getByLabel(c.height, { exact: true }).fill("160");
  await page.getByLabel(c.weight, { exact: true }).fill("75");
  await page.getByRole("button", { name: t.showResult }).click();

  const result = calculate({ sex: "female", age: 35, height: 160, weight: 75, activity: "light", goal: "lose" });
  const plan = recommend(demoPrograms, result.kcal, "lose");
  expect(plan).not.toBeNull();
  const summary = page.locator('[aria-live="polite"]');
  await expect(summary).toContainText(`${c.resultLabel}: ${formatSum(result.kcal)} ${c.kcal}.`);
  await expect(summary).toContainText(`${c.planLabel}: ${plan!.program.name} ${plan!.variant.kcal}.`);
  await expect(page.getByRole("link", { name: c.order })).toHaveAttribute(
    "href",
    `/ru/order?program=${plan!.program.slug}&kcal=${plan!.variant.kcal}`,
  );

  // The browser's Back goes to the last question, with the answers kept.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 2, name: t.body })).toBeVisible();
  await expect(page.getByLabel(c.age, { exact: true })).toHaveValue("35");
});

for (const locale of locales) {
  test(`goal pages render in ${locale}, link their program and state breadcrumbs only`, async ({ page }) => {
    const t = getDictionary(locale);
    for (const goal of GOAL_PAGES) {
      const response = await page.goto(`/${locale}/goals/${goal}`);
      expect(response?.status(), goal).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.goals.pages[goal].title);
      // A one-program goal links its program page; halal lists every program.
      const programs = GOAL_PROGRAM[goal] ? demoPrograms.filter((p) => p.slug === GOAL_PROGRAM[goal]) : demoPrograms;
      for (const program of programs) {
        await expect(page.locator(`main a[href="/${locale}/programs/${program.slug}"]`).first()).toBeVisible();
      }
      const types = await jsonLdTypes(page);
      expect(types).toContain("BreadcrumbList");
      expect(types).not.toContain("FAQPage");
    }

    const unknown = await page.goto(`/${locale}/goals/no-such-goal`);
    expect(unknown?.status()).toBe(404);
  });
}

test("calculator suite: protein, BMI and water give their estimates; the tabs mark the current tool", async ({ page }) => {
  const c = ru.calculator;
  const tools = ru.calcTools;
  const summary = page.locator('[aria-live="polite"]');

  await page.goto("/ru/calculator/protein");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(tools.protein.title);
  await expect(page.getByRole("navigation", { name: tools.crumb }).getByRole("link", { name: tools.tabs.protein })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await page.getByLabel(c.weight, { exact: true }).fill("80");
  await choose(page, c.activities.high.title);
  await choose(page, c.goals.gain.title);
  const protein = proteinNeed({ weight: 80, activity: "high", goal: "gain" });
  await expect(summary).toContainText(`${tools.protein.resultLabel}: ${protein.min}–${protein.max} ${c.grams}.`);
  await expect(page.getByRole("link", { name: c.order })).toHaveAttribute("href", `/ru/order?program=${protein.program}`);

  await page.goto("/ru/calculator/bmi");
  await page.getByLabel(c.height, { exact: true }).fill("170");
  await page.getByLabel(c.weight, { exact: true }).fill("70");
  const bmi = bodyMassIndex({ height: 170, weight: 70 });
  await expect(summary).toContainText(
    `${tools.bmi.resultLabel}: ${formatDecimal(bmi.bmi)} ${tools.bmi.unit}, ${tools.bmi.categories[bmi.category]}.`,
  );

  await page.goto("/ru/calculator/water");
  await page.getByLabel(c.weight, { exact: true }).fill("70");
  await choose(page, c.activities.moderate.title);
  const water = waterNeed({ weight: 70, activity: "moderate" });
  await expect(summary).toContainText(`${tools.water.resultLabel}: ${formatDecimal(water.min)}–${formatDecimal(water.max)} ${tools.water.unit}.`);
});

test("body goal calculator: sliders and figures give calories, a program and vitamins", async ({ page }) => {
  const c = ru.calculator;
  const tool = ru.calcTools.body;
  const summary = page.locator('[aria-live="polite"]');

  await page.goto("/ru/calculator/body");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(tool.title);
  await expect(page.getByRole("navigation", { name: ru.calcTools.crumb }).getByRole("link", { name: ru.calcTools.tabs.body })).toHaveAttribute(
    "aria-current",
    "page",
  );
  // Nothing to show until the sex, muscularity and activity are chosen.
  await expect(page.getByText(tool.resultEmpty)).toBeVisible();
  await expect(page.getByText(tool.figuresEmpty)).toBeVisible();

  await choose(page, c.female);
  await expect(page.getByText(tool.figuresEmpty)).toBeHidden();
  await page.getByLabel(c.height, { exact: true }).fill("165");
  await page.getByLabel(c.weight, { exact: true }).fill("80");
  // + nudges the slider by one.
  await page.getByRole("button", { name: tool.more.replace("{label}", c.weight) }).click();
  await expect(page.getByLabel(c.weight, { exact: true })).toHaveValue("81");
  const nowGroup = page.getByRole("group", { name: tool.muscularity });
  const average = page.getByRole("radio", { name: tool.muscularityLevels.average.title });
  await nowGroup.locator("label").filter({ has: average }).click();
  await expect(nowGroup.getByRole("radio", { name: tool.muscularityLevels.average.title })).toBeChecked();
  await choose(page, c.activities.moderate.title);

  // The goal slider starts at a first step for this height and weight.
  const goalWeight = suggestGoalWeight({ height: 165, weight: 81 });
  await expect(page.getByLabel(tool.goalWeight, { exact: true })).toHaveValue(String(goalWeight));
  const result = calculateBodyGoal({
    sex: "female",
    age: 30,
    height: 165,
    weight: 81,
    activity: "moderate",
    muscularity: "average",
    goalWeight,
  });
  const plan = recommend(demoPrograms, result.kcal, DIRECTION_GOAL[result.direction]);
  expect(plan).not.toBeNull();
  await expect(summary).toContainText(`${tool.resultLabel}: ${formatSum(result.kcal)} ${c.kcal}.`);
  await expect(summary).toContainText(`${tool.direction}: ${tool.directions[result.direction]}.`);
  await expect(summary).toContainText(`${c.planLabel}: ${plan!.program.name} ${plan!.variant.kcal}.`);
  await expect(page.getByRole("link", { name: c.order })).toHaveAttribute(
    "href",
    `/ru/order?program=${plan!.program.slug}&kcal=${plan!.variant.kcal}`,
  );

  // The goal weight stops at BMI 18.5 and says why.
  const min = minGoalWeight(165);
  await page.getByLabel(tool.goalWeight, { exact: true }).fill("40");
  await expect(page.getByLabel(tool.goalWeight, { exact: true })).toHaveValue(String(min));
  await expect(page.getByText(tool.goalMin.replace("{min}", String(min)))).toBeVisible();
  // …and above, at the higher of today's weight and the BMI 30 weight.
  await page.getByLabel(tool.goalWeight, { exact: true }).fill("200");
  await expect(page.getByLabel(tool.goalWeight, { exact: true })).toHaveValue(String(maxGoalWeight(165, 81)));

  // Vitamins and minerals for a 30-year-old woman: iron 18 mg, sodium as a limit.
  const vitamins = page.getByRole("region", { name: tool.vitaminsTitle });
  await expect(vitamins.getByText(tool.nutrients.iron.name)).toBeVisible();
  await expect(vitamins.locator("li").filter({ hasText: tool.nutrients.iron.name })).toContainText(`18 ${tool.units.mg}`);
  await expect(vitamins.locator("li").filter({ hasText: tool.nutrients.sodium.name })).toContainText(
    `${tool.limit} 2 300 ${tool.units.mg}`,
  );
  await expect(vitamins.getByText(tool.healthNote)).toBeVisible();
});

test("order form: errors keep typed values, a valid order gets the demo notice", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones get the stepped form: see the phone test below");
  const t = uz.order;
  const address = "Toshkent, Amir Temur koʻchasi 1, 5-xonadon";
  await page.goto("/uz/order");
  const submit = page.getByRole("button", { name: t.submit }).filter({ visible: true });

  await submit.click();
  for (const message of [t.errors.address, t.errors.name, t.errors.phone, t.errors.consent]) {
    await expect(page.getByText(message)).toBeVisible();
  }

  await page.getByLabel(t.address, { exact: true }).fill(address);
  await page.getByLabel(t.name, { exact: true }).fill("Test");
  await submit.click();
  await expect(page.getByText(t.errors.phone)).toBeVisible();
  await expect(page.getByText(t.errors.consent)).toBeVisible();
  await expect(page.getByText(t.errors.address)).toBeHidden();
  await expect(page.getByText(t.errors.name)).toBeHidden();
  await expect(page.getByLabel(t.address, { exact: true })).toHaveValue(address);
  await expect(page.getByLabel(t.name, { exact: true })).toHaveValue("Test");

  await page.getByLabel(t.phone, { exact: true }).fill("901234567");
  await page.getByRole("checkbox").check();
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: t.general.demo })).toBeVisible();
  await expect(page).toHaveURL(/\/uz\/order$/);
  await expect(page.getByLabel(t.name, { exact: true })).toHaveValue("Test");
});

/** A field of a server action's multipart body (React prefixes the form's keys, as in "_1_address"). */
function postedField(body: string, key: string): string | undefined {
  return new RegExp(`name="(?:_?\\d+_)?${key}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1];
}

test("order form on a phone: one step at a time, Next checks only that step, Back keeps every answer", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "phones only: wider screens show the whole form at once (next test)");
  const t = ru.order;
  const stepName = (n: number, title: string) =>
    `${t.step.replace("{n}", String(n)).replace("{total}", "3")}: ${title}`;
  const heading = (n: number, title: string) => page.getByRole("heading", { level: 2, name: stepName(n, title) });
  const plan = heading(1, t.sections.plan);
  const delivery = heading(2, t.sections.delivery);
  const contact = heading(3, t.sections.contact);
  // After a step change the bar's buttons rest for a moment (disabled); click() waits until they are enabled.
  const next = page.getByRole("button", { name: t.next, exact: true });
  const back = page.getByRole("button", { name: t.back, exact: true });
  const submit = page.getByRole("button", { name: t.submit, exact: true });
  const address = page.getByLabel(t.address, { exact: true });
  const addressText = "Ташкент, ул. Амира Темура 1, кв. 5";
  const posts: string[] = [];
  await page.clock.install();
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/ru/order") posts.push(r.postData() ?? "");
  });

  // Arriving from a program page: step 1, with that program and level chosen.
  const program = demoPrograms.find((p) => p.slug !== "balance")!;
  const variant = program.variants[program.variants.length - 1];
  await page.goto(`/ru/order?program=${program.slug}&kcal=${variant.kcal}&utm_source=e2e-phone`);
  await expect(page.locator("form").filter({ has: address })).toHaveAttribute("method", "post");
  await expect(plan).toBeVisible();
  await expect(delivery).toBeHidden();
  await expect(contact).toBeHidden();
  await expect(page.getByRole("radio", { name: program.name })).toBeChecked();
  await expect(page.getByRole("radio", { name: `${variant.kcal} ${t.kcal}` })).toBeChecked();
  await choose(page, t.weekdays);

  await next.click();
  await expect(delivery).toBeVisible();
  await expect(delivery).toBeFocused();
  await expect(plan).toBeHidden();

  // Next with the address empty: the error shows, the address takes focus, the step stays.
  await next.click();
  await expect(page.getByText(t.errors.address)).toBeVisible();
  await expect(address).toBeFocused();
  await expect(delivery).toBeVisible();
  await expect(page.getByText(t.errors.name)).toBeHidden();

  // Enter in a text field goes to the next step; it does not send the order.
  await address.fill(addressText);
  await page.getByLabel(t.comment).fill("Позвонить за 10 минут");
  await page.getByLabel(t.comment).press("Enter");
  await expect(contact).toBeVisible();
  await expect(contact).toBeFocused();
  await expect(submit).toBeVisible();
  await expect(next).toHaveCount(0);
  await page.getByLabel(t.name, { exact: true }).fill("Тест");
  await page.getByLabel(t.phone, { exact: true }).fill("901234567");
  await page.getByRole("checkbox").check();

  // The page's Back keeps every answer. The step is not in the URL.
  await back.click();
  await expect(delivery).toBeVisible();
  await expect(address).toHaveValue(addressText);
  await back.click();
  await expect(plan).toBeVisible();
  await expect(page.getByRole("radio", { name: t.weekdays })).toBeChecked();
  await expect(page.getByRole("radio", { name: program.name })).toBeChecked();
  expect(new URL(page.url()).hash).toBe("");
  await next.click();
  await expect(delivery).toBeVisible();
  await expect(address).toHaveValue(addressText);

  // A fast double tap on Next with step 3 already filled shows step 3 and sends nothing: both taps at once, and a
  // second tap that lands after step 3 is up. The page clock is paused, so that tap always comes before the
  // button's rest ends, however slow the machine.
  await next.dblclick();
  await expect(contact).toBeVisible();
  await expect(submit).toBeEnabled();
  expect(posts).toHaveLength(0);
  await back.click();
  await expect(delivery).toBeVisible();
  await expect(next).toBeEnabled();
  const spot = (await next.boundingBox())!;
  await page.clock.pauseAt(Date.now() + 60_000);
  await page.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2);
  await expect(contact).toBeVisible();
  await expect(submit).toBeDisabled();
  await page.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2);
  await page.clock.resume();
  await expect(submit).toBeEnabled();
  expect(posts).toHaveLength(0);
  await expect(page.getByText(t.errors.name)).toBeHidden();
  await expect(page.getByLabel(t.name, { exact: true })).toHaveValue("Тест");

  // The phone sends every field of all three steps, hidden or not. Demo mode answers "ordering opens soon".
  const posted = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/ru/order");
  await submit.click();
  const body = (await posted).postData() ?? "";
  const expected: Record<string, string> = {
    locale: "ru",
    utm_source: "e2e-phone",
    program: program.slug,
    variant_id: variant.id,
    schedule: "weekdays",
    address: addressText,
    comment: "Позвонить за 10 минут",
    name: "Тест",
    phone: "901234567",
    consent: "on",
  };
  for (const [key, value] of Object.entries(expected)) expect(postedField(body, key), key).toBe(value);
  for (const key of ["days", "start_date", "window"]) expect(postedField(body, key), key).toBeTruthy();
  await expect(page.getByRole("alert").filter({ hasText: t.general.demo })).toBeVisible();
  expect(posts).toHaveLength(1);

  // A field the server rejects (here a delivery window it does not offer) brings back the step that holds it.
  await page.locator('input[name="window"]:checked').evaluate((input: HTMLInputElement) => (input.value = "00:00–01:00"));
  await submit.click();
  await expect(delivery).toBeVisible();
  await expect(page.getByText(t.errors.window)).toBeVisible();
  await expect(page.locator("#order-window")).toBeFocused();
  await expect(address).toHaveValue(addressText);

  // From there Back goes to step 1, and Next twice back to step 3: no dead taps.
  await back.click();
  await expect(plan).toBeVisible();
  await next.click();
  await expect(delivery).toBeVisible();
  await next.click();
  await expect(contact).toBeVisible();
  await expect(page.getByLabel(t.name, { exact: true })).toHaveValue("Тест");
  expect(posts).toHaveLength(2);
});

test("order form on a wide screen: all three sections at once, no steps", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones get the stepped form (previous test)");
  const t = ru.order;
  await page.goto("/ru/order");
  for (const title of [t.sections.plan, t.sections.delivery, t.sections.contact]) {
    await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
  }
  await expect(page.getByLabel(t.address, { exact: true })).toBeVisible();
  await expect(page.getByLabel(t.name, { exact: true })).toBeVisible();
  await expect(page.locator("form").filter({ has: page.getByLabel(t.address, { exact: true }) })).toHaveAttribute(
    "method",
    "post",
  );
  await expect(page.getByText(t.step.replace("{n}", "1").replace("{total}", "3"), { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: t.next, exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: t.back, exact: true })).toBeHidden();
});

for (const locale of locales) {
  test(`unknown path under /${locale} renders the localized 404`, async ({ page }) => {
    const response = await page.goto(`/${locale}/no-such-page`);
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", htmlLang[locale]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(getDictionary(locale).notFound.title);
    await expect(page.getByRole("banner")).toBeVisible();
  });
}

test("host routing: no admin on the public host, noindex on the admin host", async ({ page, request, adminURL }) => {
  for (const path of ["/admin", "/admin/login"]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  }
  for (const path of ["/setup", "/robots.txt"]) {
    const response = await page.goto(adminURL(path));
    expect(response?.headers()["x-robots-tag"], path).toBe("noindex, nofollow");
  }
});

test("one URL per page: a trailing slash redirects to the page without it, on both hosts", async ({
  page,
  request,
  adminURL,
}) => {
  for (const [path, target] of [["/uz/menu/", "/uz/menu"], ["/ru/", "/ru"], ["/menu/", "/menu"]]) {
    const response = await request.get(`${path}?day=2`, { maxRedirects: 0 });
    expect(response.status(), path).toBe(308);
    const location = new URL(response.headers()["location"], "http://localhost");
    expect(location.pathname, path).toBe(target);
    expect(location.search, path).toBe("?day=2");
  }
  await page.goto(adminURL("/setup/"));
  await expect(page).toHaveURL(adminURL("/setup"));
});

test("the trailing-slash redirect never points off the site (no protocol-relative Location)", async ({
  request,
  baseURL,
}) => {
  // The rule itself, for paths a host may pass to the proxy as they came (next start collapses // first).
  for (const [path, target] of [
    ["//attacker.example/", "/attacker.example"],
    ["/\\attacker.example/", "/attacker.example"],
    ["/\\/attacker.example//x/", "/attacker.example/x"],
    ["///", "/"],
    ["/uz//menu/", "/uz/menu"],
    ["/uz/menu/", "/uz/menu"],
  ]) {
    expect(withoutTrailingSlash(path), path).toBe(target);
  }
  // And through the server.
  for (const path of ["//attacker.example/", "/%2F/attacker.example/", "/uz//menu/"]) {
    const response = await request.get(`${baseURL}${path}`, { maxRedirects: 0 });
    const location = response.headers()["location"] ?? "";
    expect(location.startsWith("//"), `${path} → ${location}`).toBe(false);
    if (location) expect(new URL(location, baseURL).host, `${path} → ${location}`).toBe(new URL(baseURL!).host);
  }
});

test("the analytics path is never locale-redirected, and is not served without the PostHog key", async ({
  request,
}) => {
  for (const path of [`${ANALYTICS_PATH}/e/`, `${ANALYTICS_PATH}/flags/?v=2`, `${ANALYTICS_PATH}/static/array.js`]) {
    expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(404);
  }
});

test("the daily Telegram run is not locale-redirected and refuses without its secret configured", async ({ request }) => {
  // Demo mode has no CRON_SECRET (scripts/e2e-server.mjs): 503 for every caller, with or without a bearer header,
  // for the schedule's GET and for POST. Never a redirect to /uz/api/…, and never a run.
  const callers: Record<string, string>[] = [{}, { Authorization: "Bearer guess" }];
  for (const headers of callers) {
    for (const method of ["get", "post"] as const) {
      const response = await request[method]("/api/telegram/daily", { headers, maxRedirects: 0 });
      expect(response.status(), `${method} ${JSON.stringify(headers)}`).toBe(503);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(await response.json()).toEqual({ error: "not_configured" });
    }
  }
});

test("robots.txt and sitemap.xml are served on the public host", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Sitemap:");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const urls = await sitemap.text();
  for (const path of ["/uz/menu", "/uz/faq", "/uz/prices", "/uz/goals/weight-loss", "/uz/calculator/body", "/uz/calculator/protein", "/uz/quiz"]) {
    expect(urls).toContain(path);
  }
});
