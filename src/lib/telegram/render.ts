import { getAdminDictionary } from "@/i18n/admin";
import { formatSum, plural, type Locale } from "@/i18n/config";
import type { OutboxKind } from "./rules";

/*
 * The text of an owner-group message (docs/plans/zarkebab-feature-port.md, slice 9a): an outbox row's facts (payload,
 * migration 0026) in the language the owner chose. Pure. Plain text, sent without parse_mode, so a staff name with
 * "*", "_" or "<" can never break the formatting. Labels the back office already has (statuses, categories, payment
 * methods, payroll kinds, roles, order fields) come from the admin dictionaries; the message phrases are below.
 *
 * The payloads carry no customer name, phone, address, comment or exclusions and no free text typed by staff; where
 * such text exists, the message says where to read it.
 */

type Payload = Record<string, unknown>;

/** The longest text Telegram accepts in one message. */
const MAX_LENGTH = 4096;

const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item !== "") : [];

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** "25.11.2026" from "2026-11-25"; "—" for anything else. */
export function formatMessageDay(value: unknown): string {
  const match = typeof value === "string" ? DAY_RE.exec(value) : null;
  return match ? `${match[3]}.${match[2]}.${match[1]}` : "—";
}

type Texts = {
  currency: string;
  kcal: string;
  months: readonly string[];
  daysShort: (n: number) => string;
  by: (name: string) => string;
  join: (items: string[]) => string;
  seeOrders: string;
  seeFinance: string;
  seePayroll: string;
  finance: {
    expense: Record<"added" | "deleted" | "changed", string>;
    income: Record<"added" | "deleted" | "changed", string>;
    changedFields: (fields: string) => string;
    fieldNames: Record<string, string>;
  };
  investor: Record<"added" | "deleted" | "changed", string>;
  seeInvestor: string;
  purchase: {
    added: string;
    changed: string;
    deleted: string;
    lines: (n: number) => string;
    buyer: (name: string) => string;
    changedFields: (fields: string) => string;
    fieldNames: Record<string, string>;
  };
  order: {
    paid: (number: string) => string;
    cancelled: (number: string) => string;
    wasStatus: (status: string) => string;
    edited: (number: string) => string;
    method: (number: string) => string;
    noMethod: string;
    seeReason: string;
  };
  payroll: {
    event: Record<"added" | "deleted" | "changed", string>;
    rate: Record<"added" | "deleted" | "changed", string>;
    rateFrom: (amount: string, unit: string, day: string) => string;
    employee: Record<"added" | "deleted" | "changed" | "ended" | "resumed" | "renamed", string>;
    firstDay: (day: string) => string;
    lastDay: (day: string) => string;
    fieldNames: Record<string, string>;
    changedFields: (fields: string) => string;
    perUnit: Record<"monthly" | "daily", string>;
  };
  close: {
    closed: (month: string) => string;
    reopened: (month: string) => string;
    result: (amount: string) => string;
  };
  team: {
    approved: string;
    added: string;
    removed: string;
    declined: string;
    roleChanged: string;
    unnamed: string;
  };
  digest: {
    title: (day: string) => string;
    yesterday: string;
    placed: (n: number) => string;
    paid: (n: number, sum: string) => string;
    cancelled: (n: number) => string;
    expenses: (n: number, sum: string) => string;
    purchases: (n: number, sum: string) => string;
    investor: (sum: string) => string;
    today: string;
    rations: (n: number) => string;
    deliveries: (n: number) => string;
    nothingToday: string;
    ending: (n: number, next: string | null) => string;
    newOrders: (n: number) => string;
    problems: (n: number) => string;
  };
  test: string;
};

const ru: Texts = {
  currency: "сум",
  kcal: "ккал",
  months: ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"],
  daysShort: (n) => `${n} дн.`,
  by: (name) => `Кто: ${name}`,
  join: (items) => items.join(", "),
  seeOrders: "Клиент и контакты — в админке, раздел «Заказы».",
  seeFinance: "Контрагент и комментарий — в админке, раздел «Финансы».",
  seePayroll: "Комментарий — в админке, раздел «Финансы» → «Зарплаты».",
  finance: {
    expense: { added: "Расход записан", deleted: "Расход удалён", changed: "Расход изменён" },
    income: { added: "Доход записан", deleted: "Доход удалён", changed: "Доход изменён" },
    changedFields: (fields) => `Изменено: ${fields}`,
    fieldNames: {
      entry_type: "тип",
      entry_date: "дата",
      category: "категория",
      payment_method: "способ оплаты",
      amount: "сумма",
      counterparty: "контрагент",
    },
  },
  investor: {
    added: "Деньги инвестора получены",
    deleted: "Запись о деньгах инвестора удалена",
    changed: "Запись о деньгах инвестора изменена",
  },
  seeInvestor: "Имя инвестора — в админке, раздел «Финансы».",
  purchase: {
    added: "Закупка",
    changed: "Закупка изменена",
    deleted: "Закупка удалена",
    lines: (n) => `${n} ${plural(n, ["позиция", "позиции", "позиций"])}`,
    buyer: (name) => `Покупал: ${name}`,
    changedFields: (fields) => `Изменено: ${fields}`,
    fieldNames: {
      entry_date: "дата",
      amount: "сумма",
      payment_method: "способ оплаты",
      buyer_name: "кто покупал",
      lines: "позиции",
      note: "комментарий",
    },
  },
  order: {
    paid: (number) => `Заказ № ${number} оплачен`,
    cancelled: (number) => `Заказ № ${number} отменён`,
    wasStatus: (status) => `Был: ${status.toLocaleLowerCase("ru")}`,
    edited: (number) => `Заказ № ${number} изменён`,
    method: (number) => `Заказ № ${number}: способ оплаты изменён`,
    noMethod: "не указан",
    seeReason: "Причина — в админке, в истории заказа.",
  },
  payroll: {
    event: { added: "Записано в зарплаты", deleted: "Удалено из зарплат", changed: "Изменено в зарплатах" },
    rate: { added: "Новая ставка", deleted: "Ставка удалена", changed: "Ставка изменена" },
    rateFrom: (amount, unit, day) => `${amount} ${unit} с ${day}`,
    employee: {
      added: "Новый сотрудник",
      deleted: "Сотрудник удалён",
      changed: "Данные сотрудника изменены",
      ended: "Сотрудник ушёл",
      resumed: "Уход сотрудника отменён",
      renamed: "Сотрудник переименован",
    },
    firstDay: (day) => `Первый день: ${day}`,
    lastDay: (day) => `Последний день: ${day}`,
    fieldNames: {
      job_title: "должность",
      joined_at: "первый день",
      ended_at: "последний день",
      employee_id: "сотрудник",
      kind: "тип",
      event_date: "дата",
      amount: "сумма",
      payment_method: "способ оплаты",
      effective_from: "с какого дня",
      rate_unit: "за что",
    },
    changedFields: (fields) => `Изменено: ${fields}`,
    perUnit: { monthly: "в месяц", daily: "в день" },
  },
  close: {
    closed: (month) => `Месяц закрыт: ${month}`,
    reopened: (month) => `Месяц снова открыт: ${month}`,
    result: (amount) => `Итог месяца: ${amount}`,
  },
  team: {
    approved: "Доступ к админке выдан",
    added: "Добавлен в команду",
    removed: "Доступ к админке закрыт",
    declined: "Заявка на доступ отклонена",
    roleChanged: "Роль в команде изменена",
    unnamed: "сотрудник без имени",
  },
  digest: {
    title: (day) => `Утренняя сводка · ${day}`,
    yesterday: "Вчера",
    placed: (n) => `Новых заказов: ${n}`,
    paid: (n, sum) => `Оплачено заказов: ${n} на ${sum}`,
    cancelled: (n) => `Отменено заказов: ${n}`,
    expenses: (n, sum) => `Расходов записано: ${n} на ${sum}`,
    purchases: (n, sum) => `Закупок: ${n} на ${sum}`,
    investor: (sum) => `Деньги инвестора: ${sum}`,
    today: "Сегодня",
    rations: (n) => `Рационов готовить: ${n}`,
    deliveries: (n) => `Доставок: ${n}`,
    nothingToday: "Сегодня доставок нет.",
    ending: (n, next) => `Планы заканчиваются (3 дня): ${n}${next ? `, ближайший ${next}` : ""}`,
    newOrders: (n) => `Ждут звонка (новые): ${n}`,
    problems: (n) => `Сообщений с ошибкой за неделю: ${n}. Повторить можно в Настройках.`,
  },
  test: "Проверка связи: сюда будут приходить сообщения Taomiq. Язык и какие сообщения присылать — в админке, «Настройки» → «Telegram».",
};

const uz: Texts = {
  currency: "soʻm",
  kcal: "kkal",
  months: ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"],
  daysShort: (n) => `${n} kun`,
  by: (name) => `Kim: ${name}`,
  join: (items) => items.join(", "),
  seeOrders: "Mijoz va aloqa maʼlumotlari — panelda, «Buyurtmalar» boʻlimida.",
  seeFinance: "Kontragent va izoh — panelda, «Moliya» boʻlimida.",
  seePayroll: "Izoh — panelda, «Moliya» → «Maoshlar» boʻlimida.",
  finance: {
    expense: { added: "Xarajat yozildi", deleted: "Xarajat oʻchirildi", changed: "Xarajat oʻzgartirildi" },
    income: { added: "Daromad yozildi", deleted: "Daromad oʻchirildi", changed: "Daromad oʻzgartirildi" },
    changedFields: (fields) => `Oʻzgardi: ${fields}`,
    fieldNames: {
      entry_type: "turi",
      entry_date: "sana",
      category: "toifa",
      payment_method: "toʻlov usuli",
      amount: "summa",
      counterparty: "kontragent",
    },
  },
  investor: {
    added: "Investor puli olindi",
    deleted: "Investor puli yozuvi oʻchirildi",
    changed: "Investor puli yozuvi oʻzgartirildi",
  },
  seeInvestor: "Investor ismi — panelda, «Moliya» boʻlimida.",
  purchase: {
    added: "Xarid",
    changed: "Xarid oʻzgartirildi",
    deleted: "Xarid oʻchirildi",
    lines: (n) => `${n} ta pozitsiya`,
    buyer: (name) => `Xarid qilgan: ${name}`,
    changedFields: (fields) => `Oʻzgardi: ${fields}`,
    fieldNames: {
      entry_date: "sana",
      amount: "summa",
      payment_method: "toʻlov usuli",
      buyer_name: "kim xarid qilgan",
      lines: "pozitsiyalar",
      note: "izoh",
    },
  },
  order: {
    paid: (number) => `Buyurtma № ${number} toʻlandi`,
    cancelled: (number) => `Buyurtma № ${number} bekor qilindi`,
    wasStatus: (status) => `Avval: ${status.toLocaleLowerCase("uz")}`,
    edited: (number) => `Buyurtma № ${number} oʻzgartirildi`,
    method: (number) => `Buyurtma № ${number}: toʻlov usuli oʻzgardi`,
    noMethod: "koʻrsatilmagan",
    seeReason: "Sababi — panelda, buyurtma tarixida.",
  },
  payroll: {
    event: { added: "Maoshlarga yozildi", deleted: "Maoshlardan oʻchirildi", changed: "Maoshlarda oʻzgartirildi" },
    rate: { added: "Yangi stavka", deleted: "Stavka oʻchirildi", changed: "Stavka oʻzgartirildi" },
    rateFrom: (amount, unit, day) => `${amount} ${unit}, ${day} dan`,
    employee: {
      added: "Yangi xodim",
      deleted: "Xodim oʻchirildi",
      changed: "Xodim maʼlumotlari oʻzgartirildi",
      ended: "Xodim ishdan ketdi",
      resumed: "Xodimning ketishi bekor qilindi",
      renamed: "Xodim ismi oʻzgartirildi",
    },
    firstDay: (day) => `Birinchi kun: ${day}`,
    lastDay: (day) => `Oxirgi kun: ${day}`,
    fieldNames: {
      job_title: "lavozim",
      joined_at: "birinchi kun",
      ended_at: "oxirgi kun",
      employee_id: "xodim",
      kind: "turi",
      event_date: "sana",
      amount: "summa",
      payment_method: "toʻlov usuli",
      effective_from: "qaysi kundan",
      rate_unit: "nima uchun",
    },
    changedFields: (fields) => `Oʻzgardi: ${fields}`,
    perUnit: { monthly: "oyiga", daily: "kuniga" },
  },
  close: {
    closed: (month) => `Oy yopildi: ${month}`,
    reopened: (month) => `Oy qayta ochildi: ${month}`,
    result: (amount) => `Oy natijasi: ${amount}`,
  },
  team: {
    approved: "Panelga kirish berildi",
    added: "Jamoaga qoʻshildi",
    removed: "Panelga kirish yopildi",
    declined: "Kirish soʻrovi rad etildi",
    roleChanged: "Jamoadagi rol oʻzgardi",
    unnamed: "ismsiz xodim",
  },
  digest: {
    title: (day) => `Ertalabki hisobot · ${day}`,
    yesterday: "Kecha",
    placed: (n) => `Yangi buyurtmalar: ${n}`,
    paid: (n, sum) => `Toʻlangan buyurtmalar: ${n}, jami ${sum}`,
    cancelled: (n) => `Bekor qilingan buyurtmalar: ${n}`,
    expenses: (n, sum) => `Yozilgan xarajatlar: ${n}, jami ${sum}`,
    purchases: (n, sum) => `Xaridlar: ${n}, jami ${sum}`,
    investor: (sum) => `Investor puli: ${sum}`,
    today: "Bugun",
    rations: (n) => `Tayyorlanadigan ratsionlar: ${n}`,
    deliveries: (n) => `Yetkazishlar: ${n}`,
    nothingToday: "Bugun yetkazish yoʻq.",
    ending: (n, next) => `Rejasi tugayotganlar (3 kun): ${n}${next ? `, eng yaqini ${next}` : ""}`,
    newOrders: (n) => `Qoʻngʻiroq kutmoqda (yangi): ${n}`,
    problems: (n) => `Bir haftada xato bilan xabarlar: ${n}. Qayta yuborish — Sozlamalarda.`,
  },
  test: "Aloqa tekshiruvi: Taomiq xabarlari shu yerga keladi. Til va qaysi xabarlar kelishi — panelda, «Sozlamalar» → «Telegram».",
};

const uzc: Texts = {
  currency: "сўм",
  kcal: "ккал",
  months: ["Январ", "Феврал", "Март", "Апрел", "Май", "Июн", "Июл", "Август", "Сентабр", "Октабр", "Ноябр", "Декабр"],
  daysShort: (n) => `${n} кун`,
  by: (name) => `Ким: ${name}`,
  join: (items) => items.join(", "),
  seeOrders: "Мижоз ва алоқа маълумотлари — панелда, «Буюртмалар» бўлимида.",
  seeFinance: "Контрагент ва изоҳ — панелда, «Молия» бўлимида.",
  seePayroll: "Изоҳ — панелда, «Молия» → «Маошлар» бўлимида.",
  finance: {
    expense: { added: "Харажат ёзилди", deleted: "Харажат ўчирилди", changed: "Харажат ўзгартирилди" },
    income: { added: "Даромад ёзилди", deleted: "Даромад ўчирилди", changed: "Даромад ўзгартирилди" },
    changedFields: (fields) => `Ўзгарди: ${fields}`,
    fieldNames: {
      entry_type: "тури",
      entry_date: "сана",
      category: "тоифа",
      payment_method: "тўлов усули",
      amount: "сумма",
      counterparty: "контрагент",
    },
  },
  investor: {
    added: "Инвестор пули олинди",
    deleted: "Инвестор пули ёзуви ўчирилди",
    changed: "Инвестор пули ёзуви ўзгартирилди",
  },
  seeInvestor: "Инвестор исми — панелда, «Молия» бўлимида.",
  purchase: {
    added: "Харид",
    changed: "Харид ўзгартирилди",
    deleted: "Харид ўчирилди",
    lines: (n) => `${n} та позиция`,
    buyer: (name) => `Харид қилган: ${name}`,
    changedFields: (fields) => `Ўзгарди: ${fields}`,
    fieldNames: {
      entry_date: "сана",
      amount: "сумма",
      payment_method: "тўлов усули",
      buyer_name: "ким харид қилган",
      lines: "позициялар",
      note: "изоҳ",
    },
  },
  order: {
    paid: (number) => `Буюртма № ${number} тўланди`,
    cancelled: (number) => `Буюртма № ${number} бекор қилинди`,
    wasStatus: (status) => `Аввал: ${status.toLocaleLowerCase("uz")}`,
    edited: (number) => `Буюртма № ${number} ўзгартирилди`,
    method: (number) => `Буюртма № ${number}: тўлов усули ўзгарди`,
    noMethod: "кўрсатилмаган",
    seeReason: "Сабаби — панелда, буюртма тарихида.",
  },
  payroll: {
    event: { added: "Маошларга ёзилди", deleted: "Маошлардан ўчирилди", changed: "Маошларда ўзгартирилди" },
    rate: { added: "Янги ставка", deleted: "Ставка ўчирилди", changed: "Ставка ўзгартирилди" },
    rateFrom: (amount, unit, day) => `${amount} ${unit}, ${day} дан`,
    employee: {
      added: "Янги ходим",
      deleted: "Ходим ўчирилди",
      changed: "Ходим маълумотлари ўзгартирилди",
      ended: "Ходим ишдан кетди",
      resumed: "Ходимнинг кетиши бекор қилинди",
      renamed: "Ходим исми ўзгартирилди",
    },
    firstDay: (day) => `Биринчи кун: ${day}`,
    lastDay: (day) => `Охирги кун: ${day}`,
    fieldNames: {
      job_title: "лавозим",
      joined_at: "биринчи кун",
      ended_at: "охирги кун",
      employee_id: "ходим",
      kind: "тури",
      event_date: "сана",
      amount: "сумма",
      payment_method: "тўлов усули",
      effective_from: "қайси кундан",
      rate_unit: "нима учун",
    },
    changedFields: (fields) => `Ўзгарди: ${fields}`,
    perUnit: { monthly: "ойига", daily: "кунига" },
  },
  close: {
    closed: (month) => `Ой ёпилди: ${month}`,
    reopened: (month) => `Ой қайта очилди: ${month}`,
    result: (amount) => `Ой натижаси: ${amount}`,
  },
  team: {
    approved: "Панелга кириш берилди",
    added: "Жамоага қўшилди",
    removed: "Панелга кириш ёпилди",
    declined: "Кириш сўрови рад этилди",
    roleChanged: "Жамоадаги рол ўзгарди",
    unnamed: "исмсиз ходим",
  },
  digest: {
    title: (day) => `Эрталабки ҳисобот · ${day}`,
    yesterday: "Кеча",
    placed: (n) => `Янги буюртмалар: ${n}`,
    paid: (n, sum) => `Тўланган буюртмалар: ${n}, жами ${sum}`,
    cancelled: (n) => `Бекор қилинган буюртмалар: ${n}`,
    expenses: (n, sum) => `Ёзилган харажатлар: ${n}, жами ${sum}`,
    purchases: (n, sum) => `Харидлар: ${n}, жами ${sum}`,
    investor: (sum) => `Инвестор пули: ${sum}`,
    today: "Бугун",
    rations: (n) => `Тайёрланадиган рационлар: ${n}`,
    deliveries: (n) => `Етказишлар: ${n}`,
    nothingToday: "Бугун етказиш йўқ.",
    ending: (n, next) => `Режаси тугаётганлар (3 кун): ${n}${next ? `, энг яқини ${next}` : ""}`,
    newOrders: (n) => `Қўнғироқ кутмоқда (янги): ${n}`,
    problems: (n) => `Бир ҳафтада хато билан хабарлар: ${n}. Қайта юбориш — Созламаларда.`,
  },
  test: "Алоқа текшируви: Taomiq хабарлари шу ерга келади. Тил ва қайси хабарлар келиши — панелда, «Созламалар» → «Telegram».",
};

const TEXTS: Record<Locale, Texts> = { ru, uz, uzc };

/** The message phrases of a language (exported for the Settings list's one-line descriptions). */
export function telegramTexts(locale: Locale): Texts {
  return TEXTS[locale];
}

function money(value: unknown, x: Texts): string {
  const n = num(value);
  return n === null ? "—" : `${formatSum(n)} ${x.currency}`;
}

function label<K extends string>(map: Record<K, string>, key: unknown): string | null {
  return typeof key === "string" && key in map ? map[key as K] : null;
}

function fieldList(fields: string[], names: Record<string, string>, x: Texts): string | null {
  const named = fields.map((field) => names[field] ?? field);
  return named.length > 0 ? x.join(named) : null;
}

function action(value: unknown): "added" | "deleted" | "changed" {
  return value === "deleted" ? "deleted" : value === "changed" ? "changed" : "added";
}

/** The parts as lines; null, false and undefined are left out, "" is a blank line. */
function lines(...parts: (string | null | false | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string").join("\n");
}

function dot(...parts: (string | null | false | undefined)[]): string | null {
  const kept = parts.filter((part): part is string => typeof part === "string" && part !== "");
  return kept.length > 0 ? kept.join(" · ") : null;
}

function monthName(value: unknown, x: Texts): string {
  const match = typeof value === "string" ? DAY_RE.exec(value) : null;
  if (!match) return "—";
  return `${x.months[Number(match[2]) - 1] ?? match[2]} ${match[1]}`;
}

function renderFinance(p: Payload, locale: Locale, investor: boolean): string {
  const x = TEXTS[locale];
  const t = getAdminDictionary(locale);
  const act = action(p.action);
  const actor = str(p.actor);
  const fields = fieldList(list(p.fields), x.finance.fieldNames, x);
  if (investor) {
    return lines(
      `${x.investor[act]}: ${money(p.amount, x)}`,
      dot(label(t.finance.methods, p.payment_method), formatMessageDay(p.entry_date)),
      fields && x.finance.changedFields(fields),
      actor && x.by(actor),
      x.seeInvestor,
    );
  }
  const heading = p.entry_type === "income" ? x.finance.income[act] : x.finance.expense[act];
  return lines(
    `${heading}: ${money(p.amount, x)}`,
    dot(label(t.finance.categories, p.category), label(t.finance.methods, p.payment_method), formatMessageDay(p.entry_date)),
    fields && x.finance.changedFields(fields),
    actor && x.by(actor),
    x.seeFinance,
  );
}

function renderPurchase(p: Payload, locale: Locale): string {
  const x = TEXTS[locale];
  const t = getAdminDictionary(locale);
  const count = num(p.lines);
  const buyer = str(p.buyer);
  const actor = str(p.actor);
  const fields = fieldList(list(p.fields), x.purchase.fieldNames, x);
  return lines(
    `${x.purchase[action(p.action)]}: ${money(p.amount, x)}`,
    dot(count !== null && x.purchase.lines(count), label(t.finance.methods, p.payment_method), formatMessageDay(p.day)),
    buyer && x.purchase.buyer(buyer),
    fields && x.purchase.changedFields(fields),
    actor && x.by(actor),
  );
}

function renderOrder(p: Payload, locale: Locale): string {
  const x = TEXTS[locale];
  const t = getAdminDictionary(locale);
  const number = num(p.number);
  const no = number === null ? "—" : String(number);
  const kcal = num(p.kcal);
  const days = num(p.days);
  const plan = dot(
    [str(p.program), kcal !== null ? `${kcal} ${x.kcal}` : null].filter(Boolean).join(" / ") || null,
    days !== null && x.daysShort(days),
    money(p.total, x),
  );
  const actor = str(p.actor);
  const method = (value: unknown) => label(t.finance.methods, value) ?? x.order.noMethod;

  switch (p.event) {
    case "paid":
      return lines(x.order.paid(no), dot(plan, label(t.finance.methods, p.payment_method)), actor && x.by(actor), x.seeOrders);
    case "cancelled": {
      const was = label(t.orders.statuses, p.from_status);
      return lines(x.order.cancelled(no), plan, was && x.order.wasStatus(was), x.order.seeReason, actor && x.by(actor));
    }
    case "payment_method":
      return lines(x.order.method(no), `${method(p.method_from)} → ${method(p.method_to)}`, plan, actor && x.by(actor));
    default: {
      // A pause added or removed (0028) is an edit named "pause".
      const fields = fieldList(list(p.fields), { ...t.order.fields, pause: t.order.pauses.field }, x);
      return lines(
        fields ? `${x.order.edited(no)}: ${fields.toLocaleLowerCase(locale === "ru" ? "ru" : "uz")}` : x.order.edited(no),
        plan,
        actor && x.by(actor),
        x.seeOrders,
      );
    }
  }
}

function renderPayroll(p: Payload, locale: Locale): string {
  const x = TEXTS[locale];
  const t = getAdminDictionary(locale);
  const name = str(p.employee_name);
  const actor = str(p.actor);
  const fields = fieldList(list(p.fields), x.payroll.fieldNames, x);
  const act = action(p.action);

  if (p.record === "rate") {
    const unit = label(x.payroll.perUnit, p.rate_unit) ?? "";
    return lines(
      name ? `${x.payroll.rate[act]}: ${name}` : x.payroll.rate[act],
      x.payroll.rateFrom(money(p.amount, x), unit, formatMessageDay(p.effective_from)),
      fields && x.payroll.changedFields(fields),
      actor && x.by(actor),
    );
  }

  if (p.record === "employee") {
    const kind = typeof p.action === "string" && p.action in x.payroll.employee ? (p.action as keyof Texts["payroll"]["employee"]) : act;
    return lines(
      name ? `${x.payroll.employee[kind]}: ${name}` : x.payroll.employee[kind],
      str(p.joined_at) && kind === "added" ? x.payroll.firstDay(formatMessageDay(p.joined_at)) : null,
      str(p.ended_at) && (kind === "ended" || kind === "resumed") ? x.payroll.lastDay(formatMessageDay(p.ended_at)) : null,
      fields && x.payroll.changedFields(fields),
      actor && x.by(actor),
    );
  }

  const kind = label(t.finance.payroll.kinds, p.event_kind);
  const amount = num(p.amount) !== null ? money(p.amount, x) : null;
  return lines(
    `${x.payroll.event[act]}: ${dot(kind, name) ?? "—"}`,
    dot(amount, label(t.finance.methods, p.payment_method), formatMessageDay(p.event_date)),
    fields && x.payroll.changedFields(fields),
    actor && x.by(actor),
    (p.event_kind === "bonus" || p.event_kind === "fine") && x.seePayroll,
  );
}

function renderClose(p: Payload, locale: Locale): string {
  const x = TEXTS[locale];
  const month = monthName(p.month_start, x);
  const actor = str(p.actor);
  return lines(
    p.action === "reopened" ? x.close.reopened(month) : x.close.closed(month),
    x.close.result(money(p.result, x)),
    actor && x.by(actor),
  );
}

function renderTeam(p: Payload, locale: Locale): string {
  const x = TEXTS[locale];
  const t = getAdminDictionary(locale);
  const name = str(p.name) ?? x.team.unnamed;
  const actor = str(p.actor);
  const role = (value: unknown) => label(t.roles, value);
  switch (p.action) {
    case "role_changed":
      return lines(`${x.team.roleChanged}: ${name}`, `${role(p.from_role) ?? "—"} → ${role(p.to_role) ?? "—"}`, actor && x.by(actor));
    case "removed":
      return lines(`${x.team.removed}: ${name}`, role(p.role), actor && x.by(actor));
    case "declined":
      return lines(`${x.team.declined}: ${name}`, actor && x.by(actor));
    case "approved":
      return lines(`${x.team.approved}: ${name}`, role(p.role), actor && x.by(actor));
    default:
      return lines(`${x.team.added}: ${name}`, role(p.role), actor && x.by(actor));
  }
}

function renderDigest(p: Payload, locale: Locale): string {
  const x = TEXTS[locale];
  const d = x.digest;
  const y = (p.yesterday && typeof p.yesterday === "object" ? p.yesterday : {}) as Payload;
  const today = (p.today && typeof p.today === "object" ? p.today : {}) as Payload;
  const n = (value: unknown) => num(value) ?? 0;

  const levels = Array.isArray(today.levels) ? (today.levels as Payload[]) : [];
  const windows = Array.isArray(today.windows) ? (today.windows as Payload[]) : [];
  const rations = levels.reduce((sum, level) => sum + n(level?.rations), 0);
  const deliveries = n(today.deliveries);
  const ending = n(p.ending);
  const problems = n(p.outbox_problems);

  const todayLines =
    rations === 0 && deliveries === 0
      ? [d.nothingToday]
      : [
          d.rations(rations),
          ...levels.map((level) => `  ${str(level?.program) ?? "—"} / ${n(level?.kcal)} ${x.kcal}: ${n(level?.rations)}`),
          d.deliveries(deliveries),
          ...windows.map((w) => `  ${str(w?.window) ?? "—"}: ${n(w?.count)}`),
        ];

  return lines(
    d.title(formatMessageDay(p.day)),
    "",
    d.yesterday,
    d.placed(n(y.placed)),
    d.paid(n(y.paid), money(n(y.paid_sum), x)),
    d.cancelled(n(y.cancelled)),
    d.expenses(n(y.expenses), money(n(y.expenses_sum), x)),
    d.purchases(n(y.purchases), money(n(y.purchases_sum), x)),
    n(y.investor_sum) > 0 && d.investor(money(n(y.investor_sum), x)),
    "",
    d.today,
    ...todayLines,
    "",
    d.ending(ending, ending > 0 && str(p.ending_next) ? formatMessageDay(p.ending_next) : null),
    d.newOrders(n(p.new_orders)),
    problems > 0 && d.problems(problems),
  );
}

/**
 * The message for one outbox row. Never throws: an unexpected payload gives a shorter text with "—" for what is
 * missing.
 */
export function renderTelegramMessage(kind: OutboxKind | string, payload: unknown, locale: Locale): string {
  const p = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as Payload;
  let text: string;
  switch (kind) {
    case "finance":
      text = renderFinance(p, locale, false);
      break;
    case "investor":
      text = renderFinance(p, locale, true);
      break;
    case "purchase":
      text = renderPurchase(p, locale);
      break;
    case "order":
      text = renderOrder(p, locale);
      break;
    case "payroll":
      text = renderPayroll(p, locale);
      break;
    case "close":
      text = renderClose(p, locale);
      break;
    case "team":
      text = renderTeam(p, locale);
      break;
    case "digest":
      text = renderDigest(p, locale);
      break;
    default:
      text = TEXTS[locale].test;
  }
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 1)}…` : text;
}
