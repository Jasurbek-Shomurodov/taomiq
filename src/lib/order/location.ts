/*
 * "Share my location" on the order form (docs/plans/customer-site-improvements.md, round 1, item 7): an optional map
 * point for the courier, beside the text address (which stays required). Shared by the form, the server action and the
 * back office, and pure, so it is checked without a browser or a database (e2e/order-location.spec.ts).
 *
 * Where the point goes: two hidden fields of the order form, then orders.delivery_lat / delivery_lng through
 * public.set_order_location (migration 0032, service_role only). Never into localStorage, a URL, analytics, a log line
 * or a Telegram message, and not into the saved delivery details of a profile.
 */

/** Tashkent's wider bounding box (the city and the nearby parts of the region). The same numbers as the check of 0032. */
export const TASHKENT_BOUNDS = { minLat: 40.9, maxLat: 41.6, minLng: 68.9, maxLng: 69.8 } as const;

/** How long the browser may take to find the point (navigator.geolocation, high accuracy). */
export const LOCATION_TIMEOUT_MS = 10_000;

/**
 * A fix less precise than this is not added: it would send the courier to the wrong block (a desktop browser placed by
 * its network can be kilometres off). The visitor is told and goes on with the text address.
 */
export const LOCATION_MAX_ACCURACY_M = 200;

/** The form's hidden fields. */
export const LOCATION_FIELDS = { lat: "delivery_lat", lng: "delivery_lng" } as const;

export type LatLng = { lat: number; lng: number };

/** Six decimals (about 0.1 m), as numeric(9,6) keeps them. */
export function roundCoord(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** "41.311081": always six decimals, for a hidden field, a map link or the printed sheet. */
export function formatCoord(value: number): string {
  return value.toFixed(6);
}

/** Inside Tashkent's wider box, edges included. */
export function inTashkent(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= TASHKENT_BOUNDS.minLat &&
    lat <= TASHKENT_BOUNDS.maxLat &&
    lng >= TASHKENT_BOUNDS.minLng &&
    lng <= TASHKENT_BOUNDS.maxLng
  );
}

/** A plain decimal: digits, an optional sign and fraction. No exponent, hex, "Infinity", "NaN" or spaces inside. */
const DECIMAL = /^[+-]?\d{1,3}(?:\.\d{1,12})?$/;

function coord(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value.trim();
  return DECIMAL.test(text) ? Number(text) : null;
}

/**
 * Two values (form fields, or numbers from the database) as a point inside Tashkent, rounded to six decimals; null when
 * either is missing, not a plain decimal number, or the point is outside the box. Anything invalid is ignored, never an
 * error: the point is optional.
 */
export function parseLocation(lat: unknown, lng: unknown): LatLng | null {
  const a = coord(lat);
  const b = coord(lng);
  if (a === null || b === null) return null;
  const point = { lat: roundCoord(a), lng: roundCoord(b) };
  return inTashkent(point.lat, point.lng) ? point : null;
}

/** The order form's point (the hidden fields), checked as parseLocation does. A field sent twice is refused. */
export function locationFromForm(form: FormData): LatLng | null {
  const lat = form.getAll(LOCATION_FIELDS.lat);
  const lng = form.getAll(LOCATION_FIELDS.lng);
  if (lat.length !== 1 || lng.length !== 1) return null;
  return parseLocation(lat[0], lng[0]);
}

/** Yandex Maps with a pin on the point (Yandex takes longitude first). */
export function yandexMapsUrl({ lat, lng }: LatLng): string {
  return `https://yandex.uz/maps/?pt=${formatCoord(lng)},${formatCoord(lat)}&z=17&l=map`;
}

/** Google Maps with a pin on the point. */
export function googleMapsUrl({ lat, lng }: LatLng): string {
  return `https://www.google.com/maps/search/?api=1&query=${formatCoord(lat)},${formatCoord(lng)}`;
}

/** "41.311081, 69.240562": the point as text (the printed delivery sheet, the order page). */
export function formatLocation({ lat, lng }: LatLng): string {
  return `${formatCoord(lat)}, ${formatCoord(lng)}`;
}
