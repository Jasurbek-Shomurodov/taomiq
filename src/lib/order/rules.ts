/**
 * Order rules shared by the order form (client) and the submitOrder action (server).
 * The database function submit_order() enforces the same rules; keep them in step.
 */

export const DEFAULT_DELIVERY_WINDOWS = ["06:00–08:00", "07:00–09:00", "08:00–10:00"];
export const DEFAULT_CUTOFF_HOUR = 14;
/** How far ahead a start date may be chosen. */
export const MAX_START_DAYS_AHEAD = 60;

export const LIMITS = {
  name: { min: 2, max: 80 },
  address: { min: 5, max: 300 },
  comment: 500,
  exclusions: 500,
} as const;

/** Query parameters kept as attribution on the order. */
export const SOURCE_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"] as const;
export const SOURCE_VALUE_MAX = 100;

export const ORDER_FIELDS = [
  "plan",
  "duration",
  "start",
  "exclusions",
  "address",
  "window",
  "comment",
  "name",
  "phone",
  "consent",
] as const;
export type OrderField = (typeof ORDER_FIELDS)[number];

/** The order form's sections, which phones show one at a time: 0 Plan, 1 Delivery, 2 Contact. */
export const ORDER_STEPS = 3;
export type OrderStep = 0 | 1 | 2;

/** The section (phone step) that holds each field. */
export const FIELD_STEP: Record<OrderField, OrderStep> = {
  plan: 0,
  duration: 0,
  start: 0,
  // With the allergen chips, on the ration step (docs/plans/allergen-exclusions.md).
  exclusions: 0,
  address: 1,
  window: 1,
  comment: 1,
  name: 2,
  phone: 2,
  consent: 2,
};
export type FieldErrorCode = "invalid" | "too_long";
export type FieldErrors = Partial<Record<OrderField, FieldErrorCode>>;

export type OrderInput = {
  variantId: string;
  days: number;
  weekdaysOnly: boolean;
  startDate: string; // YYYY-MM-DD
  address: string;
  window: string;
  comment: string;
  name: string;
  phone: string; // +998XXXXXXXXX
  /** The text saved on the order: the chosen allergens in words, then the free text (composeExclusions). */
  exclusions: string;
  consent: boolean;
};

export type OrderContext = {
  variantIds: string[];
  days: number[];
  windows: string[];
  earliest: string;
  latest: string;
};

/** "+998 90 123-45-67", "90 1234567", "998901234567" → "901234567" (at most 9 digits). */
export function phoneDigits(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 9 && digits.startsWith("998")) digits = digits.slice(3);
  return digits.slice(0, 9);
}

export function fullPhone(digits: string): string {
  return `+998${digits}`;
}

export const PHONE_RE = /^\+998[0-9]{9}$/;

/**
 * Uzbek mobile operator codes: the two digits after +998 (Beeline 90, 91; Ucell 93, 94, 50; Mobiuz 97, 88; Uzmobile 95,
 * 99, 77, 55; Perfectum 98; Humans 33; OQ 20). A hint only: the order form shows a calm "is this a mobile number?" note
 * under the phone when the code is not here, and never blocks the order. The server accepts any 9 digits (PHONE_RE).
 * A new operator: add its code here.
 */
export const UZ_MOBILE_CODES: readonly string[] = ["20", "33", "50", "55", "77", "88", "90", "91", "93", "94", "95", "97", "98", "99"];

/** "+998901234567" with a known mobile operator code (for the form's hint; never a reason to refuse an order). */
export function isUzMobile(phone: string): boolean {
  return PHONE_RE.test(phone) && UZ_MOBILE_CODES.includes(phone.slice(4, 6));
}

/**
 * What the order form's phone field keeps from what was typed, pasted or autofilled: the 9 digits after +998.
 * "+998 90 123-45-67" and "998901234567" (a whole international number) drop the 998; "90 123 45 67" and
 * "901234567" are kept as they are. Unlike phoneDigits, a 10th digit typed after a number that happens to start with
 * 998 (operator 99, then 8) never strips it: only a whole number (12 digits) or a leading "+998" does.
 */
export function phoneFromInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if ((digits.length >= 12 && digits.startsWith("998")) || /^\s*\+\s*998/.test(raw)) return digits.slice(3, 12);
  return digits.slice(0, 9);
}

/** "901234567" → "90 123 45 67"; a partial number is grouped as far as it goes ("9012" → "90 12"). */
export function formatPhone(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 9);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(" ");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- dates (Asia/Tashkent is UTC+5 all year, no daylight saving) ----------

const TASHKENT_OFFSET_MS = 5 * 3_600_000;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Add whole days to an ISO date. */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

export function isWeekend(iso: string): boolean {
  const day = weekday(iso);
  return day === 0 || day === 6;
}

/**
 * Allowed start dates for an order placed at `now`.
 * Earliest = tomorrow if the Tashkent hour is before the cutoff, otherwise the day after tomorrow.
 */
export function startDateRange(now: Date, cutoffHour: number): { earliest: string; latest: string } {
  const local = new Date(now.getTime() + TASHKENT_OFFSET_MS);
  const today = isoDate(local);
  const earliest = addDays(today, local.getUTCHours() < cutoffHour ? 1 : 2);
  return { earliest, latest: addDays(today, MAX_START_DAYS_AHEAD) };
}

/** First date on or after `iso` that suits the schedule (skips Saturday/Sunday for weekdays-only). */
export function firstDeliveryDate(iso: string, weekdaysOnly: boolean): string {
  let date = iso;
  while (weekdaysOnly && isWeekend(date)) date = addDays(date, 1);
  return date;
}

// ---------- validation ----------

export function validateOrder(input: OrderInput, ctx: OrderContext): FieldErrors {
  const errors: FieldErrors = {};

  if (!ctx.variantIds.includes(input.variantId)) errors.plan = "invalid";
  if (!ctx.days.includes(input.days)) errors.duration = "invalid";

  if (
    !DATE_RE.test(input.startDate) ||
    input.startDate < ctx.earliest ||
    input.startDate > ctx.latest ||
    (input.weekdaysOnly && isWeekend(input.startDate))
  ) {
    errors.start = "invalid";
  }

  const address = input.address.trim();
  if (address.length > LIMITS.address.max) errors.address = "too_long";
  else if (address.length < LIMITS.address.min) errors.address = "invalid";

  if (!ctx.windows.includes(input.window)) errors.window = "invalid";
  if (input.comment.trim().length > LIMITS.comment) errors.comment = "too_long";

  const name = input.name.trim();
  if (name.length > LIMITS.name.max) errors.name = "too_long";
  else if (name.length < LIMITS.name.min) errors.name = "invalid";

  if (!PHONE_RE.test(input.phone)) errors.phone = "invalid";
  if (input.exclusions.trim().length > LIMITS.exclusions) errors.exclusions = "too_long";
  if (!input.consent) errors.consent = "invalid";

  return errors;
}

/** Field ids in the order they appear on the page, used to move focus to the first error. */
export function firstErrorField(errors: FieldErrors): OrderField | undefined {
  return ORDER_FIELDS.find((field) => errors[field]);
}
