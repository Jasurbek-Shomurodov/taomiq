/**
 * Uzbek Latin → Uzbek Cyrillic, for catalogue text that has no hand-written Cyrillic yet
 * (see localized() in src/lib/data/localized.ts). A fallback, not the truth: Russian loanwords
 * such as "sentyabr" (сентябрь) come out without the soft sign, and "-tsa" verb forms get "ц".
 * Staff correct those cases in the *_uzc fields.
 *
 * Pure and dependency-free, so the admin can run it in the browser and scripts/check-translit.mjs
 * can run it under plain Node. Imports stay out of this file for the same reason.
 */

/** Words kept in Latin: the brand, program names, payment and social services. Matched case-insensitively. */
export const PROTECTED_WORDS = [
  "TAOMIQ",
  "LIGHT",
  "BALANCE",
  "PROTEIN",
  "Payme",
  "Click",
  "Telegram",
  "Instagram",
] as const;

/** Units with a fixed Cyrillic form, matched as whole lowercase words. */
const UNITS: Record<string, string> = {
  kkal: "ккал",
  "soʻm": "сўм",
  "so'm": "сўм",
  "so‘m": "сўм",
  "so`m": "сўм",
  g: "г",
  kg: "кг",
  ml: "мл",
  sm: "см",
};

/** Marks that turn o / g into oʻ / gʻ. */
const TURNED_COMMA = "ʻ'‘`";
/** Every apostrophe-like mark. One that is not part of oʻ / gʻ is the tutuq belgisi (ъ). */
const APOSTROPHES = "ʻʼ'‘’`";

const SINGLE: Record<string, string> = {
  a: "а",
  b: "б",
  c: "с",
  d: "д",
  f: "ф",
  g: "г",
  h: "ҳ",
  i: "и",
  j: "ж",
  k: "к",
  l: "л",
  m: "м",
  n: "н",
  o: "о",
  p: "п",
  q: "қ",
  r: "р",
  s: "с",
  t: "т",
  u: "у",
  v: "в",
  w: "в",
  x: "х",
  y: "й",
  z: "з",
};

const Y_PAIRS: Record<string, string> = { o: "ё", u: "ю", a: "я", e: "е" };
const VOWELS = new Set(["a", "e", "i", "o", "u"]);

const PROTECTED = new Set(PROTECTED_WORDS.map((word) => word.toLowerCase()));

/**
 * A word: Latin letters, with an apostrophe inside it (maʼlumot, oʻt) or right after o / g at its end (bogʻ).
 * Quotes around a word ('salom') are not part of it.
 */
const WORD = /[A-Za-z](?:[A-Za-z]|[ʻʼ'‘’`](?=[A-Za-z])|(?<=[OoGg])[ʻ'‘`])*/g;

const isUpper = (ch: string) => ch !== ch.toLowerCase();

function convertWord(word: string): string {
  const lower = word.toLowerCase();
  if (PROTECTED.has(lower)) return word;
  if (UNITS[lower] !== undefined) return UNITS[lower];

  const letters = word.replace(/[ʻʼ'‘’`]/g, "");
  const allCaps = letters.length > 1 && [...letters].every(isUpper);

  let out = "";
  let prevVowel = false;
  let i = 0;

  /** Appends one Cyrillic unit, upper-cased when the Latin unit starts with a capital (Sh → Ш, SH → Ш). */
  const emit = (cyr: string, start: number, vowel: boolean) => {
    out += allCaps || isUpper(word[start]) ? cyr.toUpperCase() : cyr;
    prevVowel = vowel;
  };

  while (i < lower.length) {
    const c = lower[i];
    const next = lower[i + 1] ?? "";
    const after = lower[i + 2] ?? "";

    // oʻ and gʻ first: they decide what the letters around them are (yoʻl → йўл, yongʻoq → ёнғоқ).
    if ((c === "o" || c === "g") && next && TURNED_COMMA.includes(next)) {
      emit(c === "o" ? "ў" : "ғ", i, c === "o");
      i += 2;
      continue;
    }
    if (APOSTROPHES.includes(c)) {
      emit("ъ", i, false);
      i += 1;
      continue;
    }
    if (c === "s" && next === "h") {
      emit("ш", i, false);
      i += 2;
      continue;
    }
    if (c === "c" && next === "h") {
      emit("ч", i, false);
      i += 2;
      continue;
    }
    // yo, yu, ya, ye — unless the o starts an oʻ (yoʻl → йўл).
    if (c === "y" && Y_PAIRS[next] && !(next === "o" && after && TURNED_COMMA.includes(after))) {
      emit(Y_PAIRS[next], i, true);
      i += 2;
      continue;
    }
    // ts inside a word; at the start it stays т + с.
    if (c === "t" && next === "s" && i > 0) {
      emit("ц", i, false);
      i += 2;
      continue;
    }
    if (c === "e") {
      emit(i === 0 || prevVowel ? "э" : "е", i, true);
      i += 1;
      continue;
    }

    const single = SINGLE[c];
    emit(single ?? c, i, VOWELS.has(c));
    i += 1;
  }

  return out;
}

/** Uzbek Latin text → Uzbek Cyrillic. Digits, punctuation, other scripts and protected words pass through. */
export function translit(text: string): string {
  return text.replace(WORD, convertWord);
}
