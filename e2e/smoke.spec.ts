import { bodyMassIndex, calculate, formatDecimal, proteinNeed, recommend, waterNeed } from "../src/lib/calculator";
import { GOAL_PAGES, GOAL_PROGRAM } from "../src/lib/goal-pages";
import { demoDurations, demoPrograms } from "../src/lib/data/demo";
import { pricePerDay } from "../src/lib/data/types";
import { defaultLocale, formatSum, htmlLang, localeName, locales, type Locale } from "../src/i18n/config";
import { getDictionary } from "../src/i18n";
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

test("order form: errors keep typed values, a valid order gets the demo notice", async ({ page }) => {
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

test("robots.txt and sitemap.xml are served on the public host", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Sitemap:");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  const urls = await sitemap.text();
  for (const path of ["/uz/menu", "/uz/faq", "/uz/prices", "/uz/goals/weight-loss", "/uz/calculator/protein"]) {
    expect(urls).toContain(path);
  }
});
