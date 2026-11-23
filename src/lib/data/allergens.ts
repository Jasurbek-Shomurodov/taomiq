/** Allergen codes stored on dishes, with labels for every site language. */
export const ALLERGENS = [
  { code: "gluten", ru: "Глютен", uz: "Glyuten", uzc: "Глютен" },
  { code: "milk", ru: "Молоко", uz: "Sut", uzc: "Сут" },
  { code: "egg", ru: "Яйца", uz: "Tuxum", uzc: "Тухум" },
  { code: "fish", ru: "Рыба", uz: "Baliq", uzc: "Балиқ" },
  { code: "seafood", ru: "Морепродукты", uz: "Dengiz mahsulotlari", uzc: "Денгиз маҳсулотлари" },
  { code: "nuts", ru: "Орехи", uz: "Yongʻoq", uzc: "Ёнғоқ" },
  { code: "peanut", ru: "Арахис", uz: "Yeryongʻoq", uzc: "Ерёнғоқ" },
  { code: "soy", ru: "Соя", uz: "Soya", uzc: "Соя" },
  { code: "sesame", ru: "Кунжут", uz: "Kunjut", uzc: "Кунжут" },
  { code: "honey", ru: "Мёд", uz: "Asal", uzc: "Асал" },
] as const;
