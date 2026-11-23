/**
 * The staff alert for a new order, drawn as a branded PNG card: an SVG string rasterised by sharp with
 * the fonts bundled in src/assets/fonts. No network, no personal data (no name, phone, address, comment
 * or exclusions): the card ends with a pointer to the admin, like the text alert.
 *
 * Server-only by reach: loaded only through the dynamic import in ./telegram.ts (and by the preview
 * script). Imports stay relative so scripts/preview-order-alert.mjs can run this file under plain Node.
 */
import "./alertFontConfig"; // must run before sharp loads
import { existsSync } from "node:fs";
import { join } from "node:path";
import { formatSum, plural } from "../../i18n/config";
import { ALERT_FONT_DIRECTORY, ALERT_FONT_FAMILY, ALERT_FONT_FILES } from "./alertFontConfig";

export type OrderAlert = {
  number: number;
  programName: string;
  /** Program tag colour from the catalogue, e.g. "#C7A86B". */
  tagColor: string;
  kcal: number;
  days: number;
  weekdaysOnly: boolean;
  startDate: string; // YYYY-MM-DD
  window: string;
  /** UZS. Null when the catalogue no longer has the variant or duration. */
  pricePerDay: number | null;
  total: number | null;
  locale: string;
};

// Brand tokens, src/app/globals.css.
const FOREST = "#183c34";
const IVORY = "#f6f1e8";
const GOLD = "#c7a86b";
const GRAPHITE = "#2d2d2a";
const MUTED = "#6b6b63";
const LINE = "#d9d2c2";

const WIDTH = 1200;
const PAD = 64;
const HEADER = 196;
const COLUMN_2 = 616;

const LANGUAGE: Record<string, string> = { uz: "узбекский", ru: "русский" };

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}

/**
 * Keeps what Noto Sans can draw (Latin incl. ʻ, Cyrillic, common punctuation, №) and drops the rest,
 * e.g. emoji, instead of drawing empty boxes.
 */
export function drawableText(value: string): string {
  return value
    .replace(/[^ -ɏʰ-˿̀-ͯЀ-ӿ ‐-‧ ‰-›№]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(value: string, max: number): string {
  const chars = [...value];
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

function safeColor(value: string): string {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : GOLD;
}

/** "ср, 25 ноября" — the start date as a Tashkent calendar day. */
function startDay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const day = new Date(`${date}T12:00:00+05:00`);
  if (Number.isNaN(day.getTime())) return date;
  return day.toLocaleDateString("ru-RU", { timeZone: "Asia/Tashkent", weekday: "short", day: "numeric", month: "long" });
}

function fact(x: number, y: number, label: string, value: string): string {
  return `<text x="${x}" y="${y}" font-size="18" font-weight="700" letter-spacing="2.5" fill="${MUTED}">${escapeXml(label)}</text>
    <text x="${x}" y="${y + 46}" font-size="34" font-weight="700" fill="${GRAPHITE}">${escapeXml(value)}</text>`;
}

export function orderAlertSvg(order: OrderAlert): string {
  const programName = clip(drawableText(order.programName) || "—", 26);
  const window = clip(drawableText(order.window) || "—", 24);
  const days = `${order.days} ${plural(order.days, ["день", "дня", "дней"])}`;
  const language = LANGUAGE[order.locale] ?? drawableText(order.locale);

  const programY = HEADER + 92;
  const factsY = programY + 88;
  const totalY = factsY + 230; // the "ИТОГО" label
  const bandY = totalY + 150; // muted footer band
  const footerY = bandY + 50;
  const height = bandY + 80;

  const total =
    order.total !== null && order.pricePerDay !== null
      ? `<text x="${PAD}" y="${totalY + 72}" font-size="68" font-weight="800" fill="${FOREST}">${escapeXml(formatSum(order.total))}<tspan font-size="34" font-weight="700" dx="14">сум</tspan></text>
    <text x="${PAD}" y="${totalY + 114}" font-size="24" fill="${MUTED}">${escapeXml(`${formatSum(order.pricePerDay)} сум в день`)}</text>`
      : `<text x="${PAD}" y="${totalY + 64}" font-size="40" font-weight="700" fill="${MUTED}">Сумма — в админке</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
  <rect width="${WIDTH}" height="${height}" fill="${IVORY}"/>
  <g font-family="${ALERT_FONT_FAMILY}">
    <rect width="${WIDTH}" height="${HEADER}" fill="${FOREST}"/>
    <rect y="${HEADER - 4}" width="${WIDTH}" height="4" fill="${GOLD}"/>
    <text x="${PAD}" y="${HEADER / 2 + 22}" font-size="60" font-weight="800" letter-spacing="2.5" fill="${IVORY}">TAOM<tspan fill="${GOLD}">IQ</tspan></text>
    <text x="${WIDTH - PAD}" y="80" text-anchor="end" font-size="20" font-weight="700" letter-spacing="4" fill="${GOLD}">НОВЫЙ ЗАКАЗ</text>
    <text x="${WIDTH - PAD}" y="146" text-anchor="end" font-size="56" font-weight="800" fill="${IVORY}">${escapeXml(`№ ${order.number}`)}</text>

    <circle cx="${PAD + 12}" cy="${programY - 15}" r="12" fill="${escapeXml(safeColor(order.tagColor))}"/>
    <text x="${PAD + 40}" y="${programY}" font-size="46" font-weight="800" fill="${GRAPHITE}">${escapeXml(programName)}<tspan font-size="34" font-weight="400" fill="${MUTED}" dx="20">${escapeXml(`${order.kcal} ккал`)}</tspan></text>
    <rect x="${PAD}" y="${programY + 36}" width="${WIDTH - PAD * 2}" height="2" fill="${LINE}"/>

    ${fact(PAD, factsY, "СРОК", days)}
    ${fact(COLUMN_2, factsY, "ДОСТАВКА", order.weekdaysOnly ? "только будни" : "каждый день")}
    ${fact(PAD, factsY + 110, "СТАРТ", startDay(order.startDate))}
    ${fact(COLUMN_2, factsY + 110, "ОКНО", window)}
    <rect x="${PAD}" y="${totalY - 34}" width="${WIDTH - PAD * 2}" height="2" fill="${LINE}"/>

    <text x="${PAD}" y="${totalY}" font-size="18" font-weight="700" letter-spacing="2.5" fill="${MUTED}">ИТОГО</text>
    ${total}

    <rect y="${bandY}" width="${WIDTH}" height="${height - bandY}" fill="${LINE}" fill-opacity="0.45"/>
    <text x="${PAD}" y="${footerY}" font-size="21" fill="${MUTED}">Клиент и телефон — в админке, раздел «Заказы»</text>
    <text x="${WIDTH - PAD}" y="${footerY}" text-anchor="end" font-size="21" fill="${MUTED}">${escapeXml(`Язык сайта: ${language}`)}</text>
  </g>
</svg>`;
}

/** Plain-text caption under the photo, e.g. "Новый заказ № 1001 · BALANCE 1800 ккал · 562 000 сум". */
export function orderAlertCaption(order: OrderAlert): string {
  const parts = [`Новый заказ № ${order.number}`, `${order.programName} ${order.kcal} ккал`];
  if (order.total !== null) parts.push(`${formatSum(order.total)} сум`);
  return parts.join(" · ");
}

/** Throws when the bundled fonts are missing, so the caller sends the text alert instead of boxes. */
function assertFontsAvailable(): void {
  const missing = ALERT_FONT_FILES.filter((file) => !existsSync(join(ALERT_FONT_DIRECTORY, file)));
  if (missing.length > 0) throw new Error(`Order alert fonts are missing: ${missing.join(", ")}`);
}

export async function renderOrderAlertPng(order: OrderAlert): Promise<Buffer> {
  assertFontsAvailable();
  // Loaded here, after ./alertFontConfig has set FONTCONFIG_FILE, whatever order a bundler emits imports in.
  const { default: sharp } = await import("sharp");
  return sharp(Buffer.from(orderAlertSvg(order))).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
}
