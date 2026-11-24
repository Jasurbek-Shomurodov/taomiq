import { expect, test, watchPageProblems } from "./fixtures";

/**
 * Layout smoke checks for the public pages, one page load per route in each of the `phone` and `desktop` projects
 * (docs/plans/premium-polish.md, slice 4). No screenshots: each check is a number read from the loaded page.
 *
 * - The page opens at the top. A page that scrolls itself on load (the menu once did, through
 *   `scroll-initial-target` on the active day) hides its h1 under the sticky header.
 * - Nothing is wider than the viewport (no sideways scroll on a phone).
 * - The h1 clears the sticky header at scrollY 0.
 * - No image failed to load, and no console error, page error or failed same-origin request.
 */
const ROUTES = [
  "/ru",
  "/ru/menu",
  // A late day: the day picker has to scroll its own row to show it, never the page.
  "/ru/menu?program=balance&kcal=1800&day=24",
  "/ru/prices",
  "/ru/programs/balance",
  "/ru/delivery",
  "/ru/faq",
  "/ru/quiz",
  "/ru/calculator",
  "/uz",
  "/uzc/menu",
];

for (const route of ROUTES) {
  test(`layout: ${route} opens at the top, fits the screen and clears the header`, async ({ page, baseURL }) => {
    const problems = watchPageProblems(page, baseURL!);

    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    // Hydration and any load-time scrolling are done by then; console errors from them are already collected.
    await page.waitForLoadState("networkidle");

    const layout = await page.evaluate(() => {
      const header = document.querySelector("header.site-header");
      const h1 = document.querySelectorAll("h1");
      return {
        scrollY: window.scrollY,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        h1Count: h1.length,
        headerBottom: header ? header.getBoundingClientRect().bottom : null,
        h1Bottom: h1.length ? h1[0].getBoundingClientRect().bottom : null,
        // An image that finished loading with no pixels is broken. Lazy images below the fold that have not
        // started loading are not `complete`, so they are left out rather than reported.
        brokenImages: Array.from(document.images)
          .filter((img) => img.complete && img.naturalWidth === 0)
          .map((img) => img.currentSrc || img.src || img.outerHTML.slice(0, 120)),
      };
    });

    expect(layout.scrollY, "the page scrolled itself on load").toBe(0);
    expect(layout.scrollWidth, "the page is wider than the viewport").toBeLessThanOrEqual(layout.innerWidth);
    expect(layout.headerBottom, "no sticky site header").not.toBeNull();
    expect(layout.h1Count, "one h1 per page").toBe(1);
    expect(layout.h1Bottom!, "the h1 sits under the sticky header").toBeGreaterThan(layout.headerBottom!);
    expect(layout.brokenImages, "images that failed to load").toEqual([]);
    expect(problems).toEqual([]);
  });
}
