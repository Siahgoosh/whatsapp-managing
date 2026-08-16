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

export function cityById(id) {
  return CITIES.find((c) => c.id === id || c.fa === id);
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
