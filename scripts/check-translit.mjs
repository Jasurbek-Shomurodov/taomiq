// Checks the Uzbek Latin → Cyrillic converter (src/lib/translit.ts) against known pairs.
// Usage: node scripts/check-translit.mjs   (exits 1 on any mismatch)
// Needs Node 22.18+ (runs the TypeScript file directly). There is no test runner in this repo on purpose.
import { translit } from "../src/lib/translit.ts";

/** [Latin input, expected Cyrillic] */
const CASES = [
  // oʻ and gʻ with every apostrophe form
  ["oʻt", "ўт"],
  ["o'g'il", "ўғил"],
  ["o‘zbek", "ўзбек"],
  ["o`zbek", "ўзбек"],
  ["gʻisht", "ғишт"],
  ["bogʻ", "боғ"],
  ["yongʻoq", "ёнғоқ"],
  ["yoʻl", "йўл"],
  ["koʻk noʻxat", "кўк нўхат"],
  // ’ (U+2019) and ʼ (U+02BC) after o / g are the same modifier
  ["Go’sht", "Гўшт"],
  ["yong’oq", "ёнғоқ"],
  ["o’simlik yog’i", "ўсимлик ёғи"],
  ["oʼrik", "ўрик"],
  ["bog’", "боғ"],
  ["bogʼ", "боғ"],
  ["so’m", "сўм"],
  // sh, ch, ng
  ["shahar", "шаҳар"],
  ["choy", "чой"],
  ["dengiz", "денгиз"],
  ["singil", "сингил"],
  // yo, yu, ya, ye
  ["yoz", "ёз"],
  ["yulduz", "юлдуз"],
  ["yangi", "янги"],
  ["yer", "ер"],
  ["yeryongʻoq", "ерёнғоқ"],
  ["qiyin", "қийин"],
  // ts: ц inside a word, т + с at the start
  ["funktsiya", "функция"],
  ["tsement", "тсемент"],
  // e: э at the start and after a vowel, е elsewhere
  ["ekin", "экин"],
  ["poezd", "поэзд"],
  ["kech", "кеч"],
  ["Ertalab", "Эрталаб"],
  // tutuq belgisi
  ["maʼlumot", "маълумот"],
  ["sanʼat", "санъат"],
  ["taʼm", "таъм"],
  ["maʼno", "маъно"],
  ["ma’no", "маъно"],
  ["mas'ul", "масъул"],
  ["e’lon", "эълон"],
  // single letters
  ["qatiq", "қатиқ"],
  ["hamma", "ҳамма"],
  ["xona", "хона"],
  ["jo'ja", "жўжа"],
  ["vazn", "вазн"],
  // case
  ["Shahar", "Шаҳар"],
  ["SHAHAR", "ШАҲАР"],
  ["Oʻzbekiston", "Ўзбекистон"],
  ["OʻZBEKISTON", "ЎЗБЕКИСТОН"],
  ["Gʻalaba", "Ғалаба"],
  ["Chorshanba", "Чоршанба"],
  ["Yoshlar", "Ёшлар"],
  ["SHOʻRVA", "ШЎРВА"],
  // protected words, units, digits and punctuation
  ["TAOMIQ", "TAOMIQ"],
  ["BALANCE dasturi", "BALANCE дастури"],
  ["Payme va Click orqali", "Payme ва Click орқали"],
  ["Telegram", "Telegram"],
  ["1800 kkal", "1800 ккал"],
  ["215 000 soʻm", "215 000 сўм"],
  ["250 g", "250 г"],
  ["tvorog 5%, olma, nok", "творог 5%, олма, нок"],
  ["'Salom'", "'Салом'"],
  ["", ""],
  // real catalogue text
  ["Mevali suli boʻtqasi", "Мевали сули бўтқаси"],
  ["Kaloriya nazorati", "Калория назорати"],
  ["Tovuq filesi, guruch va sabzavotlar", "Товуқ филеси, гуруч ва сабзавотлар"],
  ["tuxum, sut, bulgʻor qalampiri, pomidor, koʻkat", "тухум, сут, булғор қалампири, помидор, кўкат"],
];

let failed = 0;
for (const [input, expected] of CASES) {
  const actual = translit(input);
  if (actual !== expected) {
    failed += 1;
    console.error(`✗ ${JSON.stringify(input)} → ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

if (failed > 0) {
  console.error(`${failed} of ${CASES.length} translit checks failed.`);
  process.exit(1);
}
console.log(`All ${CASES.length} translit checks passed.`);
