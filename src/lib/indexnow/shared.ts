import { locales } from "@/i18n/config";
import { GOAL_PAGES, goalsForProgram } from "@/lib/goal-pages";

/*
 * IndexNow (docs/plans/findability-and-growth.md, slice 2): when staff change something the public site shows, the
 * changed public URLs are sent to api.indexnow.org, which shares them with Yandex and Bing (one submission reaches
 * both). Plain module, no server or client imports: the ping (ping.ts), the key file route and the e2e unit tests
 * (e2e/indexnow.spec.ts) all read it.
 */

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** Always the production host: pings are sent from Production only (ping.ts), and the key file lives there. */
export const INDEXNOW_HOST = "taomiq.uz";

/** IndexNow's own rule for a key: 8 to 128 characters, letters a–z and A–Z, digits and "-". */
const KEY_PATTERN = /^[a-zA-Z0-9-]{8,128}$/;

export function isValidIndexNowKey(key: string | null | undefined): key is string {
  return typeof key === "string" && KEY_PATTERN.test(key);
}

/** The key from the environment value, or null when it is unset or not a valid key (then nothing is served or sent). */
export function indexNowKeyFrom(raw: string | null | undefined): string | null {
  const key = raw?.trim() ?? "";
  return isValidIndexNowKey(key) ? key : null;
}

/** The settings the public site shows (Settings screen, src/lib/admin/settings.ts). */
export type PublicSetting = "deliveryWindows" | "cutoffHour" | "cycleAnchor";

/** One change in the back office, as the admin action knows it. */
export type SiteChange =
  /** A program's texts, photo, active flag, or its levels' prices, meals and active flags (saveProgram). */
  | { kind: "program"; slug: string | null }
  /** The order lengths' markups: every price per day for a length (saveDurations). */
  | { kind: "durations" }
  /** A dish's name, photo, nutrition, ingredients, allergens, active flag or archive state (saveDish, setDishArchived). */
  | { kind: "dish" }
  /** A menu day of one calorie level, or all 30 days copied into it (saveMenuDay, copyMenuFromVariant). */
  | { kind: "menu"; variantId: string }
  /** A setting the public site shows. */
  | { kind: "setting"; name: PublicSetting };

/** The public catalogue as the mapping needs it: each active program's slug and its levels' ids. */
export type CatalogueOutline = { slug: string; variantIds: string[] }[];

/** When a change cannot be placed: the pages that show the most catalogue content. */
const FALLBACK_PATHS = ["", "/menu", "/programs"];

const goalPaths = (goals: readonly string[]) => goals.map((goal) => `/goals/${goal}`);
const programPaths = (catalogue: CatalogueOutline) => catalogue.map((p) => `/programs/${p.slug}`);

/**
 * The public paths (after the locale: "" for home, "/menu") that show what changed. Every key page opens with the
 * lowest price per day (the direct answer), so a program change, which can change a price, names them all.
 */
export function changedPaths(change: SiteChange, catalogue: CatalogueOutline): string[] {
  switch (change.kind) {
    case "program":
      if (!change.slug) return FALLBACK_PATHS;
      return [
        "",
        "/programs",
        `/programs/${change.slug}`,
        "/prices",
        "/menu",
        "/delivery",
        "/calculator",
        "/quiz",
        ...goalPaths(goalsForProgram(change.slug)),
      ];
    case "durations":
      // The price table of every program, the price list, the calculator and quiz suggestions, and the home page's
      // "the trial costs the same per day as a week" line.
      return ["", "/prices", "/calculator", "/quiz", ...programPaths(catalogue)];
    case "dish":
      // Wherever dishes are shown: the menu, today's menu on the home page, the sample day of each program and goal page.
      return ["", "/menu", ...programPaths(catalogue), ...goalPaths(GOAL_PAGES)];
    case "menu": {
      const program = catalogue.find((p) => p.variantIds.includes(change.variantId));
      if (!program) return FALLBACK_PATHS;
      return ["", "/menu", `/programs/${program.slug}`, ...goalPaths(goalsForProgram(program.slug))];
    }
    case "setting":
      if (change.name === "deliveryWindows") return ["/delivery"];
      // The cutoff is on the delivery page and in the "how it works" steps of the home and goal pages.
      if (change.name === "cutoffHour") return ["", "/delivery", ...goalPaths(GOAL_PAGES)];
      // The anchor decides which menu day is "today": the home page's menu and the menu page's default day.
      return ["", "/menu"];
  }
}

/** Every locale's URL of the changed paths, each once, on the given host: what is sent to IndexNow. */
export function changedUrls(
  changes: SiteChange | readonly SiteChange[],
  catalogue: CatalogueOutline,
  host: string = INDEXNOW_HOST,
): string[] {
  const list = Array.isArray(changes) ? changes : [changes as SiteChange];
  const paths = new Set(list.flatMap((change) => changedPaths(change, catalogue)));
  return [...paths].flatMap((path) => locales.map((locale) => `https://${host}/${locale}${path}`));
}

/** The JSON body of one IndexNow submission (the key file is served at /{key}.txt on the same host). */
export function indexNowBody(key: string, urls: readonly string[], host: string = INDEXNOW_HOST) {
  return { host, key, keyLocation: `https://${host}/${key}.txt`, urlList: [...urls] };
}
