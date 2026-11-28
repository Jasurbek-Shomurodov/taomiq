import type { Page } from "@playwright/test";
import { plural } from "../src/i18n/config";
import ru from "../src/i18n/ru";
import { allergenName } from "../src/lib/allergens";
import { demoPrograms } from "../src/lib/data/demo";
import { DRAFT_KEY, DRAFT_MAX_AGE_MS, parseDraft, resolveDraft, toDraft, type DraftChoices } from "../src/lib/order/draft";
import { DEFAULT_DELIVERY_WINDOWS, firstDeliveryDate } from "../src/lib/order/rules";
import { expect, test } from "./fixtures";

/**
 * Resume an unfinished order (docs/plans/customer-site-improvements.md, round 1, item 8): the order form keeps the plan
 * choices on this device and offers them back within a week. Never anything personal.
 */

const t = ru.order;
const light = demoPrograms.find((p) => p.slug === "light")!;
const level = light.variants[light.variants.length - 1];
const window0 = DEFAULT_DELIVERY_WINDOWS[0];

const bar = (page: Page) => page.locator("[data-order-resume]");
const readDraft = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), DRAFT_KEY);
const writeStored = (page: Page, value: string) =>
  page.evaluate(([key, v]) => window.localStorage.setItem(key, v), [DRAFT_KEY, value] as const);

/** The form's radios and chips are visually hidden inside a card-like label: tap the card, as a visitor would. */
async function tap(page: Page, role: "radio" | "checkbox", name: RegExp | string) {
  const input = page.getByRole(role, { name, exact: typeof name === "string" });
  await page.locator("label").filter({ has: input }).click();
  await expect(input).toBeChecked();
}

/** Chooses LIGHT at its top level, 14 days, weekdays only, the third allowed start date, milk and the first window. */
async function choosePlan(page: Page): Promise<string> {
  await tap(page, "radio", /^LIGHT/);
  await tap(page, "radio", new RegExp(`^${level.kcal} ${t.kcal}`));
  await tap(page, "radio", /^14 /);
  await tap(page, "radio", new RegExp(`^${t.weekdays}`));
  const iso = (await page.locator('input[name="start_date"]:not([disabled])').nth(2).getAttribute("value"))!;
  const date = page.locator(`input[name="start_date"][value="${iso}"]`);
  await page.locator("label").filter({ has: date }).click();
  await expect(date).toBeChecked();
  await tap(page, "checkbox", allergenName("milk", "ru"));
  // The window is on step 2 on phones: Next, choose it, Back.
  const window = page.locator(`input[name="window"][value="${window0}"]`);
  const windowCard = page.locator("label").filter({ has: window });
  if (await windowCard.isVisible()) {
    await windowCard.click();
  } else {
    await page.getByRole("button", { name: t.next, exact: true }).click();
    await windowCard.click();
    await page.getByRole("button", { name: t.back, exact: true }).click();
  }
  await expect(window).toBeChecked();
  return iso;
}

test("the draft: only the plan fields are stored, checked on the way back in, and fitted to today's form", () => {
  const choices: DraftChoices = {
    program: "light",
    variantId: "demo-light-1500",
    kcal: 1500,
    days: 14,
    weekdaysOnly: true,
    startDate: "2026-12-07",
    window: window0,
    allergens: ["milk", "nuts"],
  };
  // Anything else on the object never reaches storage; the chips are kept in the list's own order.
  const stored = JSON.stringify(
    toDraft({ ...choices, allergens: ["nuts", "milk"], name: "Ali", phone: "901234567" } as DraftChoices, 1000),
  );
  expect(Object.keys(JSON.parse(stored)).sort()).toEqual(
    ["allergens", "days", "kcal", "program", "savedAt", "startDate", "v", "variantId", "weekdaysOnly", "window"].sort(),
  );
  const draft = parseDraft(stored, 1000)!;
  expect(draft.allergens).toEqual(["milk", "nuts"]);
  expect(parseDraft(stored, 1000 + DRAFT_MAX_AGE_MS + 1)).toBeNull();
  expect(parseDraft("{not json", 1000)).toBeNull();
  expect(parseDraft(JSON.stringify({ ...JSON.parse(stored), v: 2 }), 1000)).toBeNull();

  const form = {
    programs: demoPrograms.map((p) => ({ slug: p.slug, variants: p.variants.map((v) => ({ id: v.id, kcal: v.kcal })) })),
    days: [2, 7, 14, 30],
    windows: DEFAULT_DELIVERY_WINDOWS,
    earliest: "2026-12-01",
    latest: "2027-01-30",
  };
  const fallback = { days: 7, window: DEFAULT_DELIVERY_WINDOWS[1] };
  expect(resolveDraft(draft, form, fallback)).toEqual(choices);
  // A start date no longer allowed becomes the earliest allowed one (for weekdays only, the next weekday).
  const past = resolveDraft({ ...draft, startDate: "2026-11-20" }, { ...form, earliest: "2026-12-05" }, fallback)!;
  expect(past.startDate).toBe(firstDeliveryDate("2026-12-05", true));
  expect(past.startDate).toBe("2026-12-07"); // Sat 5 Dec → Mon 7 Dec
  // A level whose id changed is found by its calories; a length or window no longer offered falls back.
  const moved = resolveDraft({ ...draft, variantId: "old-id", days: 21, window: "05:00–06:00" }, form, fallback)!;
  expect(moved.variantId).toBe("demo-light-1500");
  expect(moved.days).toBe(7);
  expect(moved.window).toBe(DEFAULT_DELIVERY_WINDOWS[1]);
  // A program that is gone: nothing to continue.
  expect(resolveDraft({ ...draft, program: "gone" }, form, fallback)).toBeNull();
});

test("order form: the plan is saved as you go, offered back on return, and Continue restores it", async ({ page }) => {
  await page.goto("/ru/order");
  await expect(page.getByRole("radio", { name: /^BALANCE/ })).toBeChecked();
  // Nothing chosen yet: nothing saved, nothing offered.
  await expect(bar(page)).toHaveCount(0);
  expect(await readDraft(page)).toBeNull();

  const start = await choosePlan(page);
  await expect.poll(() => readDraft(page)).not.toBeNull();

  // Back later: the form starts from its defaults, and offers the saved plan.
  await page.goto("/ru/order");
  const days = `14 ${plural(14, t.dayForms)}`;
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toContainText(t.resume.title);
  await expect(bar(page)).toContainText(`LIGHT · ${level.kcal} ${t.kcal} · ${days} · ${t.weekdaysShort}`);
  await expect(page.getByRole("radio", { name: /^BALANCE/ })).toBeChecked();

  await bar(page).getByRole("button", { name: t.resume.continue }).click();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /^LIGHT/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: new RegExp(`^${level.kcal} ${t.kcal}`) })).toBeChecked();
  await expect(page.getByRole("radio", { name: /^14 / })).toBeChecked();
  await expect(page.getByRole("radio", { name: new RegExp(`^${t.weekdays}`) })).toBeChecked();
  await expect(page.locator(`input[name="start_date"][value="${start}"]`)).toBeChecked();
  await expect(page.locator(`input[name="window"][value="${window0}"]`)).toBeChecked();
  await expect(page.getByRole("checkbox", { name: allergenName("milk", "ru"), exact: true })).toBeChecked();

  // Start over: the saved plan is gone and not offered again.
  await page.goto("/ru/order");
  await bar(page).getByRole("button", { name: t.resume.startOver }).click();
  await expect(bar(page)).toHaveCount(0);
  expect(await readDraft(page)).toBeNull();
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(t.sections.plan) })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test("order form: a link that picks the plan wins over a saved draft; a draft over a week old is dropped", async ({
  page,
}) => {
  await page.goto("/ru/order");
  await choosePlan(page);
  await expect.poll(() => readDraft(page)).not.toBeNull();

  for (const query of ["?program=protein", "?program=balance&kcal=2200"]) {
    await page.goto(`/ru/order${query}`);
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(t.sections.plan) })).toBeVisible();
    await expect(bar(page), query).toHaveCount(0);
  }

  // Eight days old: not offered, and removed.
  const old = JSON.parse((await readDraft(page))!);
  await writeStored(page, JSON.stringify({ ...old, savedAt: Date.now() - DRAFT_MAX_AGE_MS - 86_400_000 }));
  await page.goto("/ru/order");
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(t.sections.plan) })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
  await expect.poll(() => readDraft(page)).toBeNull();
});

test("order form: a saved start date no longer allowed comes back as the earliest allowed date", async ({ page }) => {
  await page.goto("/ru/order");
  await choosePlan(page);
  await expect.poll(() => readDraft(page)).not.toBeNull();
  const saved = JSON.parse((await readDraft(page))!);
  await writeStored(page, JSON.stringify({ ...saved, startDate: "2020-01-06", savedAt: Date.now() }));

  await page.goto("/ru/order");
  await bar(page).getByRole("button", { name: t.resume.continue }).click();
  // The first chip that is not greyed out for weekdays only is the earliest allowed date.
  const earliest = await page.locator('input[name="start_date"]:not([disabled])').first().getAttribute("value");
  await expect(page.locator(`input[name="start_date"][value="${earliest}"]`)).toBeChecked();
  await expect(page.getByRole("radio", { name: /^LIGHT/ })).toBeChecked();
});

test("order form: nothing personal is ever stored on the device", async ({ page, isMobile }) => {
  test.skip(isMobile, "the whole form on one screen; phones save the same fields");
  const personal = {
    address: "Ташкент, ул. Амира Темура 1, кв. 5",
    comment: "Позвонить за 10 минут",
    exclusions: "кинза",
    name: "Тестовый Покупатель",
    phone: "901234567",
  };
  await page.goto("/ru/order");
  await choosePlan(page);
  await page.getByLabel(t.exclusions).fill(personal.exclusions);
  await page.getByLabel(t.address, { exact: true }).fill(personal.address);
  await page.getByLabel(t.comment).fill(personal.comment);
  await page.getByLabel(t.name, { exact: true }).fill(personal.name);
  await page.getByLabel(t.phone, { exact: true }).fill(personal.phone);
  await page.locator("#order-consent").check();
  // A last plan change after the personal fields, so the draft is written with them filled in.
  await tap(page, "radio", /^7 /);
  await expect.poll(async () => JSON.parse((await readDraft(page)) ?? "{}").days).toBe(7);

  const storage = await page.evaluate(() => {
    const all: Record<string, string> = {};
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)!;
        all[key] = store.getItem(key) ?? "";
      }
    }
    return all;
  });
  const everything = JSON.stringify(storage);
  for (const [field, value] of Object.entries(personal)) {
    expect(everything, field).not.toContain(value);
    expect(everything, field).not.toContain(JSON.stringify(value).slice(1, -1));
  }
  const draft = JSON.parse(storage[DRAFT_KEY]);
  expect(Object.keys(draft).sort()).toEqual(
    ["allergens", "days", "kcal", "program", "savedAt", "startDate", "v", "variantId", "weekdaysOnly", "window"].sort(),
  );
  expect(draft.allergens).toEqual(["milk"]);
});

test("the success page clears the saved plan: an order that is sent is never offered again", async ({ page }) => {
  await page.goto("/ru/order");
  await choosePlan(page);
  await expect.poll(() => readDraft(page)).not.toBeNull();
  await page.goto("/ru/order/success");
  await expect.poll(() => readDraft(page)).toBeNull();
  await page.goto("/ru/order");
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(t.sections.plan) })).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});
