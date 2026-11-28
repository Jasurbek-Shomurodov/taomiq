import type { BrowserContext, Page } from "@playwright/test";
import ru from "../src/i18n/ru";
import {
  LOCATION_MAX_ACCURACY_M,
  googleMapsUrl,
  inTashkent,
  locationFromForm,
  parseLocation,
  yandexMapsUrl,
} from "../src/lib/order/location";
import { expect, test } from "./fixtures";

/**
 * "Share my location" on the order form (docs/plans/customer-site-improvements.md, round 1, item 7). The browser's
 * geolocation is Playwright's: a granted permission and a set position for a fix, no permission for a refusal, and a
 * stubbed navigator.geolocation for "no fix". Demo mode answers "ordering opens soon", so what the order would carry
 * is checked in the request body the form sends.
 */

const t = ru.order;
const l = t.location;

/** Amir Temur square: inside the box. */
const TASHKENT = { latitude: 41.311081, longitude: 69.240562, accuracy: 25 };
/** Samarkand: well outside it. */
const SAMARKAND = { latitude: 39.654167, longitude: 66.959722, accuracy: 20 };

/** Every value of a field in a server action's multipart body (React prefixes the form's keys, as in "_1_address"). */
function postedFields(body: string, key: string): string[] {
  return [...body.matchAll(new RegExp(`name="(?:_?\\d+_)?${key}"\\r\\n\\r\\n([^\\r]*)`, "g"))].map((m) => m[1]);
}

async function grant(context: BrowserContext, baseURL: string | undefined, position: typeof TASHKENT) {
  await context.grantPermissions(["geolocation"], { origin: new URL(baseURL!).origin });
  await context.setGeolocation(position);
}

/** The delivery step: on screen from md, step 2 on a phone. The address is filled, as every order needs it. */
async function openDelivery(page: Page, isMobile: boolean) {
  await page.goto("/ru/order");
  if (isMobile) await page.getByRole("button", { name: t.next, exact: true }).click();
  await page.getByLabel(t.address, { exact: true }).fill("Ташкент, ул. Амира Темура 1, кв. 5");
}

/** From the delivery step: fills the contact step and sends the form; resolves with the posted body. */
async function send(page: Page, isMobile: boolean): Promise<string> {
  if (isMobile) await page.getByRole("button", { name: t.next, exact: true }).click();
  await page.getByLabel(t.name, { exact: true }).fill("Тест");
  await page.getByLabel(t.phone, { exact: true }).fill("901234567");
  await page.locator("#order-consent").check();
  const posted = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/ru/order");
  await page.getByRole("button", { name: t.submit, exact: true }).filter({ visible: true }).click();
  const body = (await posted).postData() ?? "";
  await expect(page.getByRole("alert").filter({ hasText: t.general.demo })).toBeVisible();
  return body;
}

/** Everything this origin keeps in localStorage and sessionStorage, as one string. */
const stored = (page: Page) =>
  page.evaluate(() => JSON.stringify([{ ...window.localStorage }, { ...window.sessionStorage }, document.cookie]));

test("server check of the point: plain numbers inside Tashkent's box, both or nothing", () => {
  const form = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) for (const v of [value].flat()) data.append(key, v);
    return data;
  };

  // Valid, rounded to six decimals, spaces around trimmed; numbers from the database work too.
  expect(locationFromForm(form({ delivery_lat: "41.311081", delivery_lng: "69.240562" }))).toEqual({
    lat: 41.311081,
    lng: 69.240562,
  });
  expect(locationFromForm(form({ delivery_lat: " 41.31108149 ", delivery_lng: "69.2405625" }))).toEqual({
    lat: 41.311081,
    lng: 69.240563,
  });
  expect(parseLocation(41.2, 69.3)).toEqual({ lat: 41.2, lng: 69.3 });
  // The box's edges are inside; a hair beyond is not.
  expect(parseLocation("40.9", "68.9")).toEqual({ lat: 40.9, lng: 68.9 });
  expect(parseLocation("41.6", "69.8")).toEqual({ lat: 41.6, lng: 69.8 });
  expect(parseLocation("41.600001", "69.2")).toBeNull();
  expect(parseLocation("41.3", "68.899999")).toBeNull();

  // Not shared, or only half of it.
  expect(locationFromForm(form({}))).toBeNull();
  expect(locationFromForm(form({ delivery_lat: "41.3" }))).toBeNull();
  expect(locationFromForm(form({ delivery_lat: "41.3", delivery_lng: "" }))).toBeNull();
  // Sent twice: refused, not guessed.
  expect(locationFromForm(form({ delivery_lat: ["41.3", "41.2"], delivery_lng: "69.2" }))).toBeNull();

  // Outside Tashkent, or swapped.
  expect(parseLocation(String(SAMARKAND.latitude), String(SAMARKAND.longitude))).toBeNull();
  expect(parseLocation("69.240562", "41.311081")).toBeNull();
  expect(parseLocation("0", "0")).toBeNull();

  // Anything that is not a plain decimal.
  for (const bad of ["41,3", "4.13e1", "0x29", "Infinity", "NaN", "41.3abc", "--41.3", "41.3.1", "", " ", "1e400"]) {
    expect(parseLocation(bad, "69.2"), bad).toBeNull();
    expect(parseLocation("41.3", bad), bad).toBeNull();
  }
  expect(parseLocation(Number.NaN, 69.2)).toBeNull();
  expect(parseLocation(Number.POSITIVE_INFINITY, 69.2)).toBeNull();
  expect(parseLocation(null, undefined)).toBeNull();
  expect(parseLocation({}, [])).toBeNull();

  expect(inTashkent(TASHKENT.latitude, TASHKENT.longitude)).toBe(true);
  expect(inTashkent(SAMARKAND.latitude, SAMARKAND.longitude)).toBe(false);

  // The back office's links: Yandex takes longitude first.
  const point = { lat: 41.311081, lng: 69.240562 };
  expect(yandexMapsUrl(point)).toBe("https://yandex.uz/maps/?pt=69.240562,41.311081&z=17&l=map");
  expect(googleMapsUrl(point)).toBe("https://www.google.com/maps/search/?api=1&query=41.311081,69.240562");
});

test("share my location: added with its accuracy, posted with the order, removable, never stored on the device", async ({
  page,
  context,
  baseURL,
  isMobile,
}) => {
  await grant(context, baseURL, TASHKENT);
  await openDelivery(page, isMobile);
  const share = page.getByRole("button", { name: l.share, exact: true });
  await expect(page.locator("#order-location-note")).toHaveText(l.hint);
  // The landmark hint stays under the address.
  await expect(page.locator("#order-address-hint")).toHaveText(t.addressHint);

  await share.click();
  const added = page.getByText(l.added.replace("{m}", "25"), { exact: true });
  await expect(added).toBeVisible();
  await expect(added).toHaveAttribute("data-ph-mask");
  await expect(share).toHaveCount(0);
  await expect(page.locator('input[name="delivery_lat"]')).toHaveValue("41.311081");
  await expect(page.locator('input[name="delivery_lng"]')).toHaveValue("69.240562");
  // Nothing in the address bar.
  expect(page.url()).not.toContain("41.31");

  const body = await send(page, isMobile);
  expect(postedFields(body, "delivery_lat")).toEqual(["41.311081"]);
  expect(postedFields(body, "delivery_lng")).toEqual(["69.240562"]);
  // The point survives the server's answer, as every other field does.
  await expect(page.locator('input[name="delivery_lat"]')).toHaveValue("41.311081");

  // Nowhere on the device: not in the draft, not anywhere else.
  const kept = await stored(page);
  expect(kept).not.toContain("41.31");
  expect(kept).not.toContain("69.24");
  expect(kept).not.toContain("delivery_l");

  // Remove: the button is back, and the next send carries no point.
  if (isMobile) await page.getByRole("button", { name: t.back, exact: true }).click();
  await page.getByRole("button", { name: l.removeLabel }).click();
  await expect(page.getByRole("button", { name: l.share, exact: true })).toBeVisible();
  await expect(page.locator('input[name="delivery_lat"]')).toHaveCount(0);
  const again = await send(page, isMobile);
  expect(postedFields(again, "delivery_lat")).toEqual([]);
  expect(postedFields(again, "delivery_lng")).toEqual([]);
});

test("share my location refused: a clear line, no point, and the order goes on with the text address", async ({
  page,
  context,
  isMobile,
}) => {
  // No permission granted: the browser refuses.
  await context.clearPermissions();
  await openDelivery(page, isMobile);
  await page.getByRole("button", { name: l.share, exact: true }).click();
  await expect(page.locator("#order-location-note")).toHaveText(l.denied);
  await expect(page.locator('input[name="delivery_lat"]')).toHaveCount(0);
  const body = await send(page, isMobile);
  expect(postedFields(body, "delivery_lat")).toEqual([]);
  expect(postedFields(body, "address")).toEqual(["Ташкент, ул. Амира Темура 1, кв. 5"]);
});

test("share my location outside Tashkent: not added, and the visitor is told why", async ({ page, context, baseURL, isMobile }) => {
  await grant(context, baseURL, SAMARKAND);
  await openDelivery(page, isMobile);
  await page.getByRole("button", { name: l.share, exact: true }).click();
  await expect(page.locator("#order-location-note")).toHaveText(l.outside);
  await expect(page.locator('input[name="delivery_lat"]')).toHaveCount(0);
  // A fix inside Tashkent but too rough is not added either.
  await context.setGeolocation({ ...TASHKENT, accuracy: LOCATION_MAX_ACCURACY_M * 3 });
  await page.getByRole("button", { name: l.share, exact: true }).click();
  await expect(page.locator("#order-location-note")).toHaveText(
    l.rough.replace("{m}", String(LOCATION_MAX_ACCURACY_M * 3)),
  );
  await expect(page.locator('input[name="delivery_lat"]')).toHaveCount(0);
  const body = await send(page, isMobile);
  expect(postedFields(body, "delivery_lat")).toEqual([]);
  expect(postedFields(body, "delivery_lng")).toEqual([]);
});

test("share my location with no fix: the loading state, then a clear line", async ({ page, isMobile }) => {
  // The browser answers "position unavailable" after a moment.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
          setTimeout(() => fail({ code: 2, message: "unavailable" } as GeolocationPositionError), 600),
      },
    });
  });
  await openDelivery(page, isMobile);
  const share = page.getByRole("button", { name: l.share, exact: true });
  await share.click();
  await expect(page.locator("#order-location-note")).toHaveText(l.locating);
  await expect(share).toBeDisabled();
  await expect(page.locator("#order-location-note")).toHaveText(l.unavailable);
  await expect(share).toBeEnabled();
  await expect(page.locator('input[name="delivery_lat"]')).toHaveCount(0);
});
