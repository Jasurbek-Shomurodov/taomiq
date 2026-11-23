/**
 * Demonstration catalogue.
 * Used by the public site while Supabase is not connected, so the design can be reviewed.
 * Dishes and numbers here are placeholders — NOT verified technological cards.
 */
import { SLOTS, type Dish, type Duration, type MenuItem, type Program } from "./types";

export const DEMO_ANCHOR = "2026-12-01";

const program = (
  slug: string,
  name: string,
  tag_color: string,
  tagline_uz: string,
  tagline_ru: string,
  description_uz: string,
  description_ru: string,
  sort: number,
  variants: [kcal: number, meals: number, price: number][],
): Program => ({
  id: `demo-${slug}`,
  slug,
  name,
  tag_color,
  tagline_uz,
  tagline_ru,
  tagline_uzc: "", // empty: the site converts the Latin text, as for a real row nobody has edited yet
  description_uz,
  description_ru,
  description_uzc: "",
  sort,
  active: true,
  variants: variants.map(([kcal, meals_per_day, price_per_day], index) => ({
    id: `demo-${slug}-${kcal}`,
    program_id: `demo-${slug}`,
    kcal,
    meals_per_day,
    price_per_day,
    sort: index + 1,
    active: true,
  })),
});

export const demoPrograms: Program[] = [
  program(
    "light", "LIGHT", "#A8B8A3", "Kaloriya nazorati", "Контроль калорий",
    "Vaznni xotirjam va ochlik hissisiz kamaytirish uchun yengil, toʻyimli ratsion.",
    "Лёгкий и сытный рацион, чтобы снижать вес спокойно и без чувства голода.",
    1, [[1200, 4, 215000], [1500, 5, 235000]],
  ),
  program(
    "balance", "BALANCE", "#C7A86B", "Kundalik muvozanat", "Ежедневный баланс",
    "Har kungi hayot uchun muvozanatli ovqatlanish: bozor, oshxona va hisob-kitobsiz.",
    "Сбалансированное питание на каждый день — без покупок, готовки и подсчётов.",
    2, [[1800, 5, 255000], [2200, 5, 285000]],
  ),
  program(
    "protein", "PROTEIN", "#B5714F", "Yuqori oqsilli ratsion", "Высокобелковый рацион",
    "Mashgʻulot qiluvchilar uchun: har bir mahalda koʻproq oqsil, aniq koʻrsatkichlar.",
    "Для тех, кто тренируется: больше белка в каждом приёме пищи и точные цифры.",
    3, [[2000, 5, 295000], [2500, 5, 340000]],
  ),
];

export const demoDurations: Duration[] = [
  { days: 2, markup_pct: 10, is_trial: true },
  { days: 7, markup_pct: 10, is_trial: false },
  { days: 14, markup_pct: 5, is_trial: false },
  { days: 30, markup_pct: 0, is_trial: false },
];

const dish = (
  id: string,
  name_uz: string,
  name_ru: string,
  default_weight_g: number,
  [kcal_100, protein_100, fat_100, carbs_100]: [number, number, number, number],
  ingredients_uz: string,
  ingredients_ru: string,
  allergens: string[] = [],
): Dish => ({
  id,
  name_uz,
  name_ru,
  name_uzc: "", // empty: the site converts the Latin text, as for a real row nobody has edited yet
  photo_url: null,
  default_weight_g,
  kcal_100,
  protein_100,
  fat_100,
  carbs_100,
  ingredients_uz,
  ingredients_ru,
  ingredients_uzc: "",
  allergens,
  verified: false,
  active: true,
});

export const demoDishes: Dish[] = [
  dish("d-oat", "Mevali suli boʻtqasi", "Овсяная каша с ягодами", 250, [110, 4, 3, 17],
    "suli yormasi, sut, mevalar, asal", "овсяные хлопья, молоко, ягоды, мёд", ["milk", "gluten"]),
  dish("d-omelet", "Sabzavotli omlet", "Омлет с овощами", 200, [140, 10, 10, 2.5],
    "tuxum, sut, bulgʻor qalampiri, pomidor, koʻkat", "яйцо, молоко, болгарский перец, томаты, зелень", ["egg", "milk"]),
  dish("d-syrniki", "Tvorogli sirniki", "Сырники из творога", 180, [190, 14, 7, 18],
    "tvorog, tuxum, guruch uni, qatiq sousi", "творог, яйцо, рисовая мука, йогуртовый соус", ["milk", "egg"]),
  dish("d-yogurt", "Granola bilan yogurt", "Йогурт с гранолой", 180, [120, 6, 4, 15],
    "tabiiy yogurt, granola, yongʻoq", "натуральный йогурт, гранола, орехи", ["milk", "nuts", "gluten"]),
  dish("d-hummus", "Xumus va sabzavot tayoqchalari", "Хумус с овощными палочками", 150, [150, 6, 9, 11],
    "noʻxat, tahini, zaytun moyi, sabzi, bodring", "нут, тахини, оливковое масло, морковь, огурец", ["sesame"]),
  dish("d-chicken-rice", "Tovuq filesi, guruch va sabzavotlar", "Курица с рисом и овощами", 350, [148, 11, 5, 15.5],
    "tovuq filesi, guruch, brokkoli, sabzi", "куриное филе, рис, брокколи, морковь"),
  dish("d-beef-buckwheat", "Mol goʻshti va grechka", "Говядина с гречкой", 350, [155, 12, 6, 13],
    "mol goʻshti, grechka, piyoz, sabzi", "говядина, гречка, лук, морковь"),
  dish("d-turkey-bulgur", "Kurka goʻshti va bulgur", "Индейка с булгуром", 350, [145, 12, 4.5, 14],
    "kurka filesi, bulgur, qovoqcha, pomidor", "филе индейки, булгур, кабачок, томаты", ["gluten"]),
  dish("d-protein-bowl", "Tovuq va kinoa bouli", "Боул с курицей и киноа", 300, [140, 13, 5, 11],
    "tovuq filesi, kinoa, avokado, makkajoʻxori", "куриное филе, киноа, авокадо, кукуруза"),
  dish("d-cottage", "Mevali tvorog", "Творог с фруктами", 200, [105, 12, 3, 8],
    "tvorog 5%, olma, nok", "творог 5%, яблоко, груша", ["milk"]),
  dish("d-salmon", "Losos va sabzavotlar", "Лосось с овощами", 300, [150, 13, 9, 5],
    "losos, koʻk noʻxat, brokkoli, limon", "лосось, стручковая фасоль, брокколи, лимон", ["fish"]),
  dish("d-lentil-soup", "Yasmiq shoʻrva", "Чечевичный суп", 300, [70, 4.5, 2, 9],
    "qizil yasmiq, sabzi, piyoz, ziravorlar", "красная чечевица, морковь, лук, специи"),
  dish("d-chicken-salad", "Tovuqli salat", "Салат с курицей", 250, [115, 11, 6, 4],
    "tovuq filesi, salat barglari, bodring, pomidor, zaytun moyi", "куриное филе, листья салата, огурец, томаты, оливковое масло"),
  dish("d-fish-veg", "Bugʻda pishgan baliq va sabzavotlar", "Рыба на пару с овощами", 300, [105, 14, 3.5, 4.5],
    "sudak, gulkaram, sabzi", "судак, цветная капуста, морковь", ["fish"]),
];

// Three demo days. Each day: [breakfast, snack1, lunch, snack2, dinner]
const DAYS: string[][] = [
  ["d-oat", "d-yogurt", "d-chicken-rice", "d-cottage", "d-salmon"],
  ["d-omelet", "d-hummus", "d-beef-buckwheat", "d-yogurt", "d-chicken-salad"],
  ["d-syrniki", "d-cottage", "d-turkey-bulgur", "d-protein-bowl", "d-fish-veg"],
];

function buildMenu(): MenuItem[] {
  const byId = new Map(demoDishes.map((d) => [d.id, d]));
  const items: MenuItem[] = [];
  for (const p of demoPrograms) {
    for (const variant of p.variants) {
      DAYS.forEach((day, dayIndex) => {
        const slots = variant.meals_per_day >= 5 ? SLOTS : SLOTS.filter((s) => s !== "snack2");
        const dishes = slots.map((slot) => ({ slot, dish: byId.get(day[SLOTS.indexOf(slot)])! }));
        // Scale default portions so the day lands near the variant's calorie target.
        const baseKcal = dishes.reduce((sum, e) => sum + (e.dish.kcal_100 * e.dish.default_weight_g) / 100, 0);
        const scale = variant.kcal / baseKcal;
        for (const { slot, dish: d } of dishes) {
          items.push({
            id: `demo-${variant.id}-${dayIndex + 1}-${slot}`,
            variant_id: variant.id,
            cycle_day: dayIndex + 1,
            slot,
            dish_id: d.id,
            weight_g: Math.round((d.default_weight_g * scale) / 10) * 10,
          });
        }
      });
    }
  }
  return items;
}

export const demoMenu: MenuItem[] = buildMenu();
