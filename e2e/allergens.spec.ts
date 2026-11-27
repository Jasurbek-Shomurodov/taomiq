import { plural } from "../src/i18n/config";
import ru from "../src/i18n/ru";
import uz from "../src/i18n/uz";
import {
  ALLERGEN_KEYS,
  allergenName,
  composeExclusions,
  exclusionTagsOf,
  normalizeTags,
  parseAllergenParam,
  parseExclusions,
} from "../src/lib/allergens";
import { demoDishes, demoMenu, demoPrograms } from "../src/lib/data/demo";
import { LIMITS } from "../src/lib/order/rules";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Allergen chips at order and the menu's allergen filter (docs/plans/allergen-exclusions.md). Demo mode: the order form
 * answers "ordering opens soon", so what the order would carry is checked in the form's summary (the same
 * composeExclusions the server action calls) and in the request body the form sends.
 */

/** Every value of a field in a server action's multipart body (React prefixes the form's keys, as in "_1_allergens"). */
function postedFields(body: string, key: string): string[] {
  return [...body.matchAll(new RegExp(`name="(?:_?\\d+_)?${key}"\\r\\n\\r\\n([^\\r]*)`, "g"))].map((m) => m[1]);
}

/** The chips are visually hidden checkboxes inside a chip-like label: tap the chip, as a visitor would. */
async function tap(page: Page, name: string, checked: boolean) {
  const box = page.getByRole("checkbox", { name, exact: true });
  await page.locator("label").filter({ has: box }).click();
  await expect(box).toBeChecked({ checked });
}

test("exclusions text: the chosen allergens in words first, and taken apart again in every language", () => {
  expect(composeExclusions(["milk", "nuts"], " лук ", "ru")).toBe("Без: молоко, орехи. лук");
  expect(composeExclusions(["milk", "nuts"], "", "ru")).toBe("Без: молоко, орехи.");
  expect(composeExclusions([], "  лук ", "ru")).toBe("лук");
  expect(composeExclusions(["egg", "mushrooms"], "piyoz", "uz")).toBe("Boʻlmasin: tuxum, qoʻziqorin. piyoz");
  expect(composeExclusions(["seafood"], "", "uzc")).toBe("Бўлмасин: денгиз маҳсулотлари.");

  // Back from any language, as a repeated order is prefilled.
  for (const locale of ["ru", "uz", "uzc"] as const) {
    const text = composeExclusions(["gluten", "peanut", "soy"], "лук, перец", locale);
    expect(parseExclusions(text)).toEqual({ tags: ["gluten", "peanut", "soy"], other: "лук, перец" });
  }
  // Older orders and anything typed by hand stay whole text.
  expect(parseExclusions("qoʻziqorin")).toEqual({ tags: [], other: "qoʻziqorin" });
  expect(parseExclusions("Без: лука и чеснока. мёд")).toEqual({ tags: [], other: "Без: лука и чеснока. мёд" });
  expect(parseExclusions("Без: молоко")).toEqual({ tags: [], other: "Без: молоко" });

  // Known keys only, each once, in the list's order; the URL's list the same way.
  expect(normalizeTags(["nuts", "milk", "nuts", "honey", 5])).toEqual(["milk", "nuts"]);
  expect(parseAllergenParam("nuts,MILK,bogus,,milk")).toEqual(["milk", "nuts"]);
  expect(parseAllergenParam(["fish", "egg"])).toEqual(["egg", "fish"]);

  // All ten chosen still leave room for the free text inside the order's limit.
  expect(composeExclusions([...ALLERGEN_KEYS], "", "ru").length).toBeLessThan(LIMITS.exclusions / 4);
  for (const key of ALLERGEN_KEYS) {
    for (const locale of ["ru", "uz", "uzc"] as const) expect(allergenName(key, locale)).not.toBe(key);
  }
});

test("kitchen sheet: the exclusions text wins over the tags stored at order, also after staff edit it", () => {
  const stored = ["milk", "nuts"];
  // As placed: the prefix gives the tags, the sheet shows only the rest.
  expect(exclusionTagsOf("Без: молоко, орехи. лук", stored)).toEqual({ tags: ["milk", "nuts"], text: "лук" });
  // Staff added fish to the words: fish counts too.
  expect(exclusionTagsOf("Без: молоко, орехи, рыба. лук", stored)).toEqual({
    tags: ["milk", "nuts", "fish"],
    text: "лук",
  });
  // Staff removed nuts: no longer grouped as "without nuts".
  expect(exclusionTagsOf("Без: молоко. лук", stored)).toEqual({ tags: ["milk"], text: "лук" });
  // Rewritten without the prefix: the stored tags hold only while the text still names every one of them.
  expect(exclusionTagsOf("молоко и орехи нельзя, лук тоже", stored)).toEqual({
    tags: ["milk", "nuts"],
    text: "молоко и орехи нельзя, лук тоже",
  });
  expect(exclusionTagsOf("молоко нельзя, рыбу тоже", stored)).toEqual({ tags: [], text: "молоко нельзя, рыбу тоже" });
  expect(exclusionTagsOf("Sut va yongʻoq boʻlmasin", stored)).toEqual({ tags: ["milk", "nuts"], text: "Sut va yongʻoq boʻlmasin" });
  // Text cleared: nothing to leave out, whatever was stored.
  expect(exclusionTagsOf("", stored)).toEqual({ tags: [], text: "" });
  // Older orders: no tags stored, the whole text.
  expect(exclusionTagsOf("qoʻziqorin", [])).toEqual({ tags: [], text: "qoʻziqorin" });
});

test("order form: allergen chips on the ration step, listed in the summary and sent with the free text", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the summary card shows from md; phones: next test");
  const t = ru.order;
  const a = ru.allergens;
  const summary = page.locator("[data-order-exclusions-summary]");
  await page.goto("/ru/order");

  // Under the ration section, with the swap rule and the traces line; the free text is "something else".
  const plan = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: t.sections.plan }) });
  await expect(plan.getByRole("group", { name: `${a.title} · ${t.optional}` })).toBeVisible();
  await expect(plan.getByLabel(t.exclusions)).toBeVisible();
  await expect(page.locator("#order-exclusions-hint")).toHaveText(`${a.swapNote} ${a.traces}`);
  await expect(summary).toHaveCount(0);

  await tap(page, allergenName("nuts", "ru"), true);
  await tap(page, allergenName("milk", "ru"), true);
  await tap(page, allergenName("fish", "ru"), true);
  await tap(page, allergenName("fish", "ru"), false);
  // In the list's order, whatever order they were tapped in.
  await expect(summary).toHaveText("Без: молоко, орехи.");
  await page.getByLabel(t.exclusions).fill("лук");
  await expect(summary).toHaveText("Без: молоко, орехи. лук");

  const posted = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/ru/order");
  await page.getByLabel(t.address, { exact: true }).fill("Ташкент, ул. Амира Темура 1, кв. 5");
  await page.getByLabel(t.name, { exact: true }).fill("Тест");
  await page.getByLabel(t.phone, { exact: true }).fill("901234567");
  await page.locator("#order-consent").check();
  await page.getByRole("button", { name: t.submit }).filter({ visible: true }).click();
  const body = (await posted).postData() ?? "";
  expect(postedFields(body, "allergens")).toEqual(["milk", "nuts"]);
  expect(postedFields(body, "exclusions")).toEqual(["лук"]);
  await expect(page.getByRole("alert").filter({ hasText: t.general.demo })).toBeVisible();
  // Nothing chosen is lost on the answer.
  await expect(page.getByRole("checkbox", { name: allergenName("milk", "ru"), exact: true })).toBeChecked();
  await expect(summary).toHaveText("Без: молоко, орехи. лук");
});

test("order form on a phone: the chips and the free text are on step 1", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phones only: the stepped form");
  const t = uz.order;
  await page.goto("/uz/order");
  const milk = page.getByRole("checkbox", { name: allergenName("milk", "uz"), exact: true });
  await expect(milk).toBeAttached();
  await tap(page, allergenName("milk", "uz"), true);
  await expect(page.getByLabel(t.exclusions)).toBeVisible();
  await page.getByRole("button", { name: t.next, exact: true }).click();
  await expect(page.getByLabel(t.address, { exact: true })).toBeVisible();
  // Step 2 is up: the chips are kept, just not on screen.
  await expect(milk).toBeHidden();
  await page.getByRole("button", { name: t.back, exact: true }).click();
  await expect(milk).toBeChecked();
});

test("menu: ?allergens= outlines the dishes holding them, on the server, with the swap rule under the day", async ({
  page,
  request,
}) => {
  const a = ru.allergens;
  const program = demoPrograms[0];
  const variant = program.variants[0];
  const dishes = new Map(demoDishes.map((d) => [d.id, d]));
  const day = demoMenu.filter((m) => m.variant_id === variant.id && m.cycle_day === 1);
  const holding = day.filter((m) => dishes.get(m.dish_id)!.allergens.some((c) => c === "milk" || c === "nuts")).length;
  expect(holding).toBeGreaterThan(0);
  expect(holding).toBeLessThan(day.length);
  const line = `Молоко, орехи — в ${holding} ${plural(holding, a.dishForms)} этого дня. ${a.swapNote}`;

  // In the server's HTML, not added later in the browser.
  const html = await (await request.get(`/ru/menu?program=${program.slug}&kcal=${variant.kcal}&allergens=nuts,milk&day=1`)).text();
  expect(html).toContain("data-allergen-summary");
  expect(html).toContain(a.swapNote);

  await page.goto(`/ru/menu?program=${program.slug}&kcal=${variant.kcal}&allergens=nuts,milk&day=1`);
  await expect(page.locator("[data-allergen-summary]")).toHaveText(line);
  await expect(page.locator("[data-allergen-match]")).toHaveCount(holding);
  const filter = page.getByRole("group", { name: a.filter });
  await expect(filter.getByRole("link", { name: allergenName("milk", "ru") })).toHaveAttribute("aria-current", "true");
  await expect(filter.getByRole("link", { name: allergenName("fish", "ru") })).not.toHaveAttribute("aria-current", "true");

  // Another day keeps the filter.
  await page.locator('a[href$="day=2"]').first().click();
  await expect(page).toHaveURL(/[?&]allergens=milk,nuts&day=2$/);
  await expect(page.locator("[data-allergen-summary]")).toBeVisible();

  // A chip toggles its allergen; "Clear" drops the filter and the outlines.
  await filter.getByRole("link", { name: allergenName("milk", "ru") }).click();
  await expect(page).toHaveURL(/[?&]allergens=nuts&day=2$/);
  await filter.getByRole("link", { name: a.clear }).click();
  await expect(page).toHaveURL((url) => !url.searchParams.has("allergens"));
  await expect(page.locator("[data-allergen-summary]")).toHaveCount(0);
  await expect(page.locator("[data-allergen-match]")).toHaveCount(0);

  // An unknown key is ignored.
  await page.goto("/ru/menu?allergens=bogus&day=1");
  await expect(page.locator("[data-allergen-summary]")).toHaveCount(0);
});
