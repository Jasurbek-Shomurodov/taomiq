import { LIMITS, MAX_START_DAYS_AHEAD, PHONE_RE, addDays, isWeekend } from "@/lib/order/rules";
import { STAFF_NOTE_MAX } from "./orders";

/*
 * The back office's order form (docs/plans/zarkebab-feature-port.md, slice 2): a new order added by hand
 * (/orders/new) and the edit of an open order (/orders/[id]/edit). Pure and not server-only: the forms use these
 * rules to show problems and enable Save, and the actions (order-actions.ts) check again with them. The database is
 * the authority (staff_create_order and staff_edit_order, migration 0018) and checks the same rules.
 *
 * Unlike the site's form, the start date may be today: staff know what the kitchen can still do, so the site's cutoff
 * hour does not apply. Limits are the site's (lib/order/rules.ts).
 */

export const STAFF_ORDER_FIELDS = [
  "plan",
  "duration",
  "start",
  "window",
  "name",
  "phone",
  "address",
  "comment",
  "exclusions",
  "note",
] as const;
export type StaffOrderField = (typeof STAFF_ORDER_FIELDS)[number];
export type StaffFieldProblem = "invalid" | "too_long";
export type StaffOrderErrors = Partial<Record<StaffOrderField, StaffFieldProblem>>;

export type StaffOrderContact = {
  name: string;
  phone: string; // +998XXXXXXXXX
  address: string;
  window: string;
  comment: string;
  exclusions: string;
};

export type StaffOrderSchedule = {
  startDate: string; // YYYY-MM-DD
  weekdaysOnly: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A phone typed by staff → "+998XXXXXXXXX", or null when it is not exactly an Uzbek number. After removing spaces,
 * dashes, brackets and a leading "+", only 9 digits or 12 digits starting with 998 are accepted. Never truncated or
 * guessed (unlike the site's phoneDigits, whose field takes the 9 digits after a fixed +998): "8 90 123 45 67", an extra
 * digit or a foreign number are refused instead of saving a different, valid-looking number.
 */
export function staffPhone(raw: string): string | null {
  const compact = raw.trim().replace(/[\s\-()]/g, "").replace(/^\+/, "");
  if (/^\d{9}$/.test(compact)) return `+998${compact}`;
  if (/^998\d{9}$/.test(compact)) return `+${compact}`;
  return null;
}

/** The start dates staff may pick on `today` (Tashkent, "YYYY-MM-DD"): today up to 60 days ahead. */
export function staffStartRange(today: string): { earliest: string; latest: string } {
  return { earliest: today, latest: addDays(today, MAX_START_DAYS_AHEAD) };
}

/** The first weekday on or after `iso` when weekdays-only, else `iso`. */
export function firstAllowedStart(iso: string, weekdaysOnly: boolean): string {
  let date = iso;
  while (weekdaysOnly && isWeekend(date)) date = addDays(date, 1);
  return date;
}

export function checkSchedule(schedule: StaffOrderSchedule, today: string): StaffOrderErrors {
  const { earliest, latest } = staffStartRange(today);
  const { startDate, weekdaysOnly } = schedule;
  const ok =
    DATE_RE.test(startDate) &&
    startDate >= earliest &&
    startDate <= latest &&
    !(weekdaysOnly && isWeekend(startDate));
  return ok ? {} : { start: "invalid" };
}

/**
 * Contact and delivery fields. `keepWindow`: the window the order already has, still accepted after it was removed
 * from the settings (an edit that does not touch the window must not fail because of it).
 */
export function checkContact(
  contact: StaffOrderContact,
  windows: readonly string[],
  keepWindow?: string,
): StaffOrderErrors {
  const errors: StaffOrderErrors = {};
  const name = contact.name.trim();
  if (name.length > LIMITS.name.max) errors.name = "too_long";
  else if (name.length < LIMITS.name.min) errors.name = "invalid";

  if (!PHONE_RE.test(contact.phone)) errors.phone = "invalid";

  const address = contact.address.trim();
  if (address.length > LIMITS.address.max) errors.address = "too_long";
  else if (address.length < LIMITS.address.min) errors.address = "invalid";

  if (!windows.includes(contact.window) && contact.window !== keepWindow) errors.window = "invalid";
  if (contact.comment.trim().length > LIMITS.comment) errors.comment = "too_long";
  if (contact.exclusions.trim().length > LIMITS.exclusions) errors.exclusions = "too_long";
  return errors;
}

export function checkNote(note: string): StaffOrderErrors {
  return note.trim().length > STAFF_NOTE_MAX ? { note: "too_long" } : {};
}

export function hasErrors(errors: StaffOrderErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Codes raised by staff_create_order and staff_edit_order → the field they are about. */
export const DB_FIELD_ERRORS: Record<string, StaffOrderErrors> = {
  invalid_variant: { plan: "invalid" },
  invalid_days: { duration: "invalid" },
  invalid_date: { start: "invalid" },
  invalid_phone: { phone: "invalid" },
  invalid_name: { name: "invalid" },
  invalid_address: { address: "invalid" },
  invalid_window: { window: "invalid" },
};

/** The field code in a database error message, if any. `too_long` names no field: the form's checks catch it first. */
export function dbFieldError(message: string): StaffOrderErrors | null {
  const code = Object.keys(DB_FIELD_ERRORS).find((c) => message.includes(c));
  return code ? DB_FIELD_ERRORS[code] : null;
}
