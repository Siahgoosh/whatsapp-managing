export const CITIES = [
  { id: "lamerd", fa: "لامرد", en: "lamerd", aliases: ["لامرد"] },
  { id: "mehr", fa: "مهر", en: "mehr", aliases: ["مهر"] },
  { id: "galedar", fa: "گله‌دار", en: "galedar", aliases: ["گله‌دار", "گله دار", "گلهدار"] },
  { id: "ashkanan", fa: "اشکنان", en: "ashkanan", aliases: ["اشکنان"] },
  { id: "alamrudasht", fa: "علامرودشت", en: "alamrudasht", aliases: ["علامرودشت"] },
  { id: "chahvarz", fa: "چاهورز", en: "chahvarz", aliases: ["چاهورز"] },
  { id: "beyram", fa: "بیرم", en: "beyram", aliases: ["بیرم"] }
];

export const CATEGORIES = [
  "خرید و فروش ملک",
  "اجاره",
  "سرمایه‌گذاری",
  "عمومی",
  "کسب‌وکار",
  "اخبار محلی",
  "استخدام",
  "خدمات",
  "سایر"
];

export const CITY_TAGS = [...CITIES.map((c) => c.fa), "سایر"];

export function cityById(id) {
  return CITIES.find((c) => c.id === id || c.fa === id);
}

export function inferCityFromName(name = "") {
  const n = String(name || "");
  for (const city of CITIES) {
    if (city.aliases.some((alias) => alias && n.includes(alias)) || n.includes(city.fa)) {
      return city.fa;
    }
  }
  return "سایر";
}

export function normalizeCityTag(value) {
  if (!value) return "سایر";
  const hit = cityById(value);
  if (hit) return hit.fa;
  if (CITY_TAGS.includes(value)) return value;
  return inferCityFromName(value);
}

export function generateQueries(city) {
  const fa = city.fa;
  const en = city.en;
  const spaced = city.aliases.find((a) => a.includes(" ")) || fa.replace("‌", " ");
  return [
    `واتساپ ${fa}`,
    `گروه واتساپ ${fa}`,
    `لینک گروه واتساپ ${fa}`,
    `گروه های واتساپ ${fa}`,
    `whatsapp group ${en}`,
    `chat.whatsapp.com ${en}`,
    `"chat.whatsapp.com" "${fa}"`,
    `"chat.whatsapp.com" "${spaced}"`
  ];
}
