import { normalizeTags, type AllergenKey } from "@/lib/allergens";
import { firstDeliveryDate, isWeekend } from "./rules";

/*
 * Resume an unfinished order (docs/plans/customer-site-improvements.md, round 1, item 8). The order form keeps the
 * visitor's plan choices on this device as they go, so someone who switched to Instagram or Telegram mid-order can
 * pick up where they left off within a week. Only these non-personal choices are ever stored: program, calorie level,
 * order length, weekdays only, start date, delivery window and allergen chips. Never the name, phone, address,
 * courier comment or the free-text exclusions. Plain module: the order form, the success page and the e2e suite read it.
 */

export const DRAFT_KEY = "taomiq:order-draft";
/** A draft older than this (since its last change) is not offered and is removed. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const VERSION = 1;

export type OrderDraft = {
  v: typeof VERSION;
  /** When it was last written (ms since epoch). */
  savedAt: number;
  program: string;
  variantId: string;
  /** The level's calories: finds the level again if its id changed. */
  kcal: number;
  days: number;
  weekdaysOnly: boolean;
  /** YYYY-MM-DD */
  startDate: string;
  window: string;
  allergens: AllergenKey[];
};

/** The choices as the form holds them. Exactly these fields reach storage (toDraft copies them one by one). */
export type DraftChoices = Omit<OrderDraft, "v" | "savedAt">;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHORT_TEXT = /^[\w:–—\- ]{1,64}$/u;

/**
 * A stored draft, checked field by field; null when missing, malformed or from another version, and, given `now`,
 * when older than DRAFT_MAX_AGE_MS.
 */
export function parseDraft(raw: string | null, now?: number): OrderDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const d = value as Record<string, unknown>;
  if (d.v !== VERSION || typeof d.savedAt !== "number" || !Number.isFinite(d.savedAt)) return null;
  if (now !== undefined && (now - d.savedAt > DRAFT_MAX_AGE_MS || d.savedAt - now > 60_000)) return null;
  if (typeof d.program !== "string" || !SHORT_TEXT.test(d.program)) return null;
  if (typeof d.variantId !== "string" || !SHORT_TEXT.test(d.variantId)) return null;
  if (!Number.isInteger(d.kcal) || !Number.isInteger(d.days)) return null;
  if (typeof d.weekdaysOnly !== "boolean") return null;
  if (typeof d.startDate !== "string" || !ISO_DATE.test(d.startDate)) return null;
  if (typeof d.window !== "string" || d.window.length > 32) return null;
  if (!Array.isArray(d.allergens)) return null;
  return toDraft(
    {
      program: d.program,
      variantId: d.variantId,
      kcal: d.kcal as number,
      days: d.days as number,
      weekdaysOnly: d.weekdaysOnly,
      startDate: d.startDate,
      window: d.window,
      allergens: normalizeTags(d.allergens),
    },
    d.savedAt,
  );
}

/** The stored shape, built field by field so nothing else the form holds can slip in. */
export function toDraft(choices: DraftChoices, savedAt: number): OrderDraft {
  return {
    v: VERSION,
    savedAt,
    program: choices.program,
    variantId: choices.variantId,
    kcal: choices.kcal,
    days: choices.days,
    weekdaysOnly: choices.weekdaysOnly,
    startDate: choices.startDate,
    window: choices.window,
    allergens: normalizeTags(choices.allergens),
  };
}

type Catalogue = {
  programs: { slug: string; variants: { id: string; kcal: number }[] }[];
  days: number[];
  windows: string[];
  earliest: string;
  latest: string;
};

/**
 * A draft fitted to today's form: its program and level if they are still offered (the level found by id, else by
 * calories), its order length and window if still offered, and its start date if still allowed for its schedule,
 * otherwise the earliest allowed date. null when its program is gone: there is nothing to continue then.
 */
export function resolveDraft(draft: OrderDraft, catalogue: Catalogue, fallback: { days: number; window: string }): DraftChoices | null {
  const program = catalogue.programs.find((p) => p.slug === draft.program);
  if (!program || program.variants.length === 0) return null;
  const variant =
    program.variants.find((v) => v.id === draft.variantId) ??
    program.variants.find((v) => v.kcal === draft.kcal) ??
    program.variants[0];
  const allowed =
    draft.startDate >= catalogue.earliest &&
    draft.startDate <= catalogue.latest &&
    !(draft.weekdaysOnly && isWeekend(draft.startDate));
  let startDate = allowed ? draft.startDate : firstDeliveryDate(catalogue.earliest, draft.weekdaysOnly);
  if (startDate > catalogue.latest) startDate = catalogue.earliest;
  return {
    program: program.slug,
    variantId: variant.id,
    kcal: variant.kcal,
    days: catalogue.days.includes(draft.days) ? draft.days : fallback.days,
    weekdaysOnly: draft.weekdaysOnly,
    startDate,
    window: catalogue.windows.includes(draft.window) ? draft.window : fallback.window,
    allergens: draft.allergens,
  };
}

// ---------- storage (browser only; every call survives blocked storage) ----------

export function readDraftRaw(): string | null {
  try {
    return window.localStorage.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
}

/** The stored draft as text when it is valid and recent, else null: the order form's snapshot of it. */
export function readFreshDraft(): string | null {
  const raw = readDraftRaw();
  return parseDraft(raw, Date.now()) ? raw : null;
}

export function writeDraft(choices: DraftChoices): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(toDraft(choices, Date.now())));
  } catch {
    // Storage blocked or full: the form works the same, only without resuming.
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}
