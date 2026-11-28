import { getDictionary } from "../src/i18n";
import { formatSum, locales } from "../src/i18n/config";
import { demoPrograms } from "../src/lib/data/demo";
import { lowestPricePerDay } from "../src/lib/data/types";
import { brandWith, directAnswer, joinWords } from "../src/lib/direct-answer";
import { GOAL_PAGES, goalPrograms } from "../src/lib/goal-pages";
import {
  INDEXNOW_HOST,
  changedPaths,
  changedUrls,
  indexNowBody,
  indexNowKeyFrom,
  isValidIndexNowKey,
  type CatalogueOutline,
} from "../src/lib/indexnow/shared";
import { expect, test } from "./fixtures";

/**
 * Findability, slice 2 (docs/plans/findability-and-growth.md): IndexNow (key rule, which pages a back-office change
 * names, the key file), robots.txt on both hosts, the search engines' ownership tags and the direct answer each key
 * page opens with. The demo build has no INDEXNOW_KEY and is not Production, so it never pings (scripts/e2e-server.mjs).
 */

const catalogue: CatalogueOutline = [
  { slug: "light", variantIds: ["v-light-1200", "v-light-1500"] },
  { slug: "balance", variantIds: ["v-balance-1800"] },
  { slug: "protein", variantIds: ["v-protein-2000"] },
];

test("IndexNow key: 8–128 letters, digits or '-', from a trimmed environment value", () => {
  expect(isValidIndexNowKey("abcd1234")).toBe(true);
  expect(isValidIndexNowKey("0f8e2b6a-5d9c-4c1e-9a7b-3e2d1c0b9a8f")).toBe(true);
  expect(isValidIndexNowKey("A".repeat(128))).toBe(true);
  for (const bad of ["", "abc1234", "A".repeat(129), "abcd 1234", "abcd_1234", "ключ12345", "abcd1234.txt", "../etc/pw"]) {
    expect(isValidIndexNowKey(bad), bad).toBe(false);
  }
  expect(isValidIndexNowKey(undefined)).toBe(false);
  expect(isValidIndexNowKey(null)).toBe(false);
  expect(indexNowKeyFrom("  abcd1234\n")).toBe("abcd1234");
  expect(indexNowKeyFrom("")).toBeNull();
  expect(indexNowKeyFrom(undefined)).toBeNull();
  expect(indexNowKeyFrom("short")).toBeNull();
});

test("IndexNow URLs: each change names the public pages that show it, in every locale, on taomiq.uz", () => {
  // A program: everything that lists programs or opens with the lowest price, its own page and its goal pages.
  expect(changedPaths({ kind: "program", slug: "light" }, catalogue)).toEqual([
    "",
    "/programs",
    "/programs/light",
    "/prices",
    "/menu",
    "/delivery",
    "/calculator",
    "/quiz",
    "/goals/weight-loss",
    "/goals/halal",
  ]);
  // A program the action could not name: home, menu and programs.
  expect(changedPaths({ kind: "program", slug: null }, catalogue)).toEqual(["", "/menu", "/programs"]);
  // Markups: every price table.
  expect(changedPaths({ kind: "durations" }, catalogue)).toEqual([
    "",
    "/prices",
    "/calculator",
    "/quiz",
    "/programs/light",
    "/programs/balance",
    "/programs/protein",
  ]);
  // A dish: the menu, today's menu on the home page, every sample day.
  expect(changedPaths({ kind: "dish" }, catalogue)).toEqual([
    "",
    "/menu",
    "/programs/light",
    "/programs/balance",
    "/programs/protein",
    ...GOAL_PAGES.map((goal) => `/goals/${goal}`),
  ]);
  // A menu day: found through the level's program; an unknown level falls back to home, menu and programs.
  expect(changedPaths({ kind: "menu", variantId: "v-protein-2000" }, catalogue)).toEqual([
    "",
    "/menu",
    "/programs/protein",
    "/goals/high-protein",
    "/goals/halal",
  ]);
  expect(changedPaths({ kind: "menu", variantId: "gone" }, catalogue)).toEqual(["", "/menu", "/programs"]);
  // Settings the public site shows.
  expect(changedPaths({ kind: "setting", name: "deliveryWindows" }, catalogue)).toEqual(["/delivery"]);
  expect(changedPaths({ kind: "setting", name: "cutoffHour" }, catalogue)).toEqual([
    "",
    "/delivery",
    ...GOAL_PAGES.map((goal) => `/goals/${goal}`),
  ]);
  expect(changedPaths({ kind: "setting", name: "cycleAnchor" }, catalogue)).toEqual(["", "/menu"]);

  // Every locale of every path, each URL once, on the production host whatever the site URL is.
  const urls = changedUrls([{ kind: "setting", name: "cycleAnchor" }, { kind: "setting", name: "deliveryWindows" }], catalogue);
  expect(urls).toEqual(["", "/menu", "/delivery"].flatMap((path) => locales.map((l) => `https://taomiq.uz/${l}${path}`)));
  expect(new Set(changedUrls([{ kind: "dish" }, { kind: "dish" }], catalogue)).size).toBe(
    changedUrls({ kind: "dish" }, catalogue).length,
  );
  expect(INDEXNOW_HOST).toBe("taomiq.uz");

  expect(indexNowBody("abcd1234", ["https://taomiq.uz/uz"])).toEqual({
    host: "taomiq.uz",
    key: "abcd1234",
    keyLocation: "https://taomiq.uz/abcd1234.txt",
    urlList: ["https://taomiq.uz/uz"],
  });
});

test("IndexNow key file: a 404 while INDEXNOW_KEY is unset, and no other .txt file is taken over", async ({ request }) => {
  for (const path of ["/abcd1234.txt", "/0f8e2b6a-5d9c-4c1e-9a7b-3e2d1c0b9a8f.txt", "/api/indexnow/abcd1234"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(404);
  }
  expect((await request.get("/llms.txt")).status()).toBe(200);
  expect((await request.get("/robots.txt")).status()).toBe(200);
});

test("robots.txt: search and AI crawlers allowed by name, private paths disallowed; the admin host disallows all", async ({
  request,
  adminURL,
}) => {
  const text = await (await request.get("/robots.txt")).text();
  for (const bot of [
    "OAI-SearchBot",
    "GPTBot",
    "ChatGPT-User",
    "PerplexityBot",
    "ClaudeBot",
    "Claude-SearchBot",
    "YandexBot",
    "Googlebot",
    "Google-Extended",
    "Bingbot",
  ]) {
    expect(text, bot).toMatch(new RegExp(`^User-Agent: ${bot}$`, "m"));
  }
  expect(text).toMatch(/^User-Agent: \*$/m);
  // Every group repeats the same rules: a crawler named in one group never reads the "*" group.
  const groups = text.split(/\n\s*\n/).filter((block) => block.includes("User-Agent:"));
  expect(groups.length).toBeGreaterThan(1);
  for (const group of groups) {
    for (const line of ["Allow: /", "Disallow: /admin", "Disallow: /api/", "Disallow: /auth/", "Disallow: /k7r2"]) {
      expect(group, line).toContain(line);
    }
    // Pages with their own noindex stay fetchable, so crawlers can read it.
    expect(group).not.toMatch(/Disallow: \/(uz|uzc|ru)\b/);
  }
  expect(text).toMatch(/^Sitemap: .+\/sitemap\.xml$/m);

  const admin = await request.get(adminURL("/robots.txt"));
  expect(admin.status()).toBe(200);
  expect(admin.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  const adminText = await admin.text();
  expect(adminText).toMatch(/^User-Agent: \*$/im);
  expect(adminText).toMatch(/^Disallow: \/$/m);
  expect(adminText).not.toContain("Allow: /\n");
  expect(adminText).not.toContain("Sitemap:");
});

test("ownership tags: the ones set are on every public page, the unset one is left out, none on the admin", async ({
  page,
  adminURL,
}) => {
  // scripts/e2e-server.mjs sets made-up Google and Yandex values and leaves Bing empty.
  for (const path of ["/uz", "/ru/menu", "/uzc/programs/light"]) {
    await page.goto(path);
    await expect(page.locator('meta[name="google-site-verification"]'), path).toHaveAttribute(
      "content",
      "e2e-google-verification",
    );
    await expect(page.locator('meta[name="yandex-verification"]'), path).toHaveAttribute(
      "content",
      "e2e-yandex-verification",
    );
    await expect(page.locator('meta[name="msvalidate.01"]'), path).toHaveCount(0);
  }
  await page.goto(adminURL("/setup"));
  await expect(page.locator('meta[name="google-site-verification"]')).toHaveCount(0);
  await expect(page.locator('meta[name="yandex-verification"]')).toHaveCount(0);
});

test("sitemap: no lastModified without a recorded change time (the demo catalogue has none)", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain("/uz/menu");
  expect(xml).not.toContain("<lastmod>");
});

test("direct answers: each key page's hero lead says what, where, the 'from' price and how to order", async ({ page }) => {
  const locale = "ru";
  const t = getDictionary(locale);
  const a = t.answer;
  const all = demoPrograms.filter((p) => p.variants.length > 0);
  const names = all.map((p) => p.name);
  const lowest = lowestPricePerDay(all);
  const program = all[0];

  const cases: [string, string][] = [
    ["", directAnswer(a, a.home, { brand: "TAOMIQ" }, lowest)],
    ["/programs", directAnswer(a, a.programs, { brand: brandWith(a, names) }, lowest)],
    [
      `/programs/${program.slug}`,
      directAnswer(
        a,
        a.program,
        {
          brand: brandWith(a, [program.name]),
          kind: a.programKinds[program.slug] ?? a.programKind,
          levels: joinWords(program.variants.map((v) => String(v.kcal)), a.or),
          kcal: t.programs.kcal,
        },
        lowestPricePerDay([program]),
      ),
    ],
    ["/prices", directAnswer(a, a.prices, { brand: "TAOMIQ" }, lowest)],
    // The demo catalogue has a menu, so the published wording.
    ["/menu", directAnswer(a, a.menu, { brand: brandWith(a, names) }, lowest)],
    ["/delivery", directAnswer(a, a.delivery, { brand: "TAOMIQ" }, lowest)],
    ["/calculator", directAnswer(a, a.calculator, { brand: "TAOMIQ" }, lowest)],
    ...GOAL_PAGES.map((goal): [string, string] => {
      const shown = goalPrograms(all, goal);
      return [
        `/goals/${goal}`,
        directAnswer(a, a.goals[goal], { brand: brandWith(a, shown.map((p) => p.name)) }, lowestPricePerDay(shown)),
      ];
    }),
  ];

  for (const [path, answer] of cases) {
    await page.goto(`/${locale}${path}`);
    const hero = page.getByRole("main").locator("section").first();
    await expect(hero.getByText(answer, { exact: true }), path).toBeVisible();
    // Two sentences, Tashkent named, the price as the site writes it, and how to order.
    expect(answer.split(/[.!?](?:\s|$)/).filter(Boolean), path).toHaveLength(2);
    expect(answer, path).toContain("Ташкент");
    expect(answer, path).toMatch(/ \d{3}(\u00a0\d{3})+ /);
  }
});

test("direct answers: every language fills every placeholder", () => {
  for (const locale of locales) {
    const a = getDictionary(locale).answer;
    const templates = [a.home, a.programs, a.program, a.prices, a.menu, a.menuSoon, a.delivery, a.calculator, ...Object.values(a.goals)];
    for (const template of templates) {
      const filled = directAnswer(a, template, { brand: "TAOMIQ", kind: "k", levels: "1", kcal: "kcal" }, 215000);
      expect(filled, `${locale}: ${template}`).not.toMatch(/[{}]/);
      expect(filled).toContain(formatSum(215000));
    }
    expect(directAnswer(a, a.home, { brand: "TAOMIQ" }, null)).not.toContain("{price}");
  }
});
