import "server-only";
import { after } from "next/server";
import { isLocale, localeNameRu } from "@/i18n/config";
import { formatDay } from "@/lib/admin/orders";
import { createSecretClient } from "@/lib/supabase/secret";
import type { OrderAlert } from "./alertImage";

/** What the order action knows. The money is read back from the saved order, after the response. */
export type OrderAlertInput = Omit<OrderAlert, "pricePerDay" | "total">;

/**
 * Optional Telegram alert to the staff chat on each new order.
 * Off unless both variables are set. Sent as a branded card image (./alertImage); if the image cannot be
 * made or Telegram refuses it, as the plain text below. Neither carries a name, phone or address: those stay in the
 * admin, behind the owner's and managers' logins. A failed alert never fails the order, and its contents are never logged.
 */
const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
const staffChatId = process.env.TELEGRAM_STAFF_CHAT_ID ?? "";

const TIMEOUT_MS = 5000;
/** An upload is slower than a text message; a timeout means "maybe delivered", so give it room. */
const PHOTO_TIMEOUT_MS = 15_000;

function alertText(order: OrderAlert): string {
  return [
    `Новый заказ № ${order.number}`,
    `${order.programName} / ${order.kcal} ккал · ${order.days} дн., ${order.weekdaysOnly ? "только будни" : "каждый день"}`,
    `Старт: ${formatDay(order.startDate)} · ${order.window}`,
    `Язык сайта: ${isLocale(order.locale) ? localeNameRu[order.locale] : order.locale}`,
    "Клиент и телефон — в админке, раздел «Заказы».",
  ].join("\n");
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : "unknown error");

/**
 * The amounts submit_order() stored. The catalogue cache can lag behind the live prices, so the card
 * shows the saved figures. Only these two columns are read: no personal data. Null when the read fails.
 */
async function storedMoney(number: number): Promise<Pick<OrderAlert, "pricePerDay" | "total">> {
  try {
    const { data, error } = await createSecretClient()
      .from("orders")
      .select("price_per_day, total")
      .eq("number", number)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
      .maybeSingle();
    if (error || !data) {
      console.error("Order alert amount not read", error?.code ?? "not found");
      return { pricePerDay: null, total: null };
    }
    const pricePerDay = Number(data.price_per_day);
    const total = Number(data.total);
    return Number.isFinite(pricePerDay) && Number.isFinite(total)
      ? { pricePerDay, total }
      : { pricePerDay: null, total: null };
  } catch (error) {
    console.error("Order alert amount not read", errorName(error));
    return { pricePerDay: null, total: null };
  }
}

/**
 * The card as a photo.
 * "not_sent": it surely did not arrive (no image, or Telegram refused it), so the text may go instead.
 * "unknown": a timeout, network error, 429 or 5xx; it may have arrived, so nothing more is sent.
 */
async function sendPhotoAlert(order: OrderAlert): Promise<"sent" | "not_sent" | "unknown"> {
  let png: Buffer;
  let caption: string;
  try {
    // Loaded only here, so sharp stays off the order action's cold start.
    const { renderOrderAlertPng, orderAlertCaption } = await import("./alertImage");
    png = await renderOrderAlertPng(order);
    caption = orderAlertCaption(order);
  } catch (error) {
    console.error("Order alert image failed", errorName(error));
    return "not_sent";
  }

  try {
    const form = new FormData();
    form.set("chat_id", staffChatId);
    form.set("photo", new Blob([new Uint8Array(png)], { type: "image/png" }), `order-${order.number}.png`);
    form.set("caption", caption.slice(0, 1024));
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
    });
    // Status only: the response body echoes the message, and the URL holds the bot token.
    if (response.ok) return "sent";
    console.error("Telegram order alert photo failed", response.status);
    return response.status >= 400 && response.status < 500 && response.status !== 429 ? "not_sent" : "unknown";
  } catch (error) {
    console.error("Telegram order alert photo failed", errorName(error));
    return "unknown";
  }
}

async function sendTextAlert(order: OrderAlert): Promise<void> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: staffChatId, text: alertText(order) }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) console.error("Telegram order alert failed", response.status);
  } catch (error) {
    console.error("Telegram order alert failed", errorName(error));
  }
}

async function sendOrderAlert(input: OrderAlertInput): Promise<void> {
  const order: OrderAlert = { ...input, ...(await storedMoney(input.number)) };
  // Text only when the photo surely did not arrive, so staff never get the same order twice.
  if ((await sendPhotoAlert(order)) === "not_sent") await sendTextAlert(order);
}

/** Sends the alert after the response is sent. Never throws. */
export function scheduleOrderAlert(order: OrderAlertInput): void {
  if (!botToken || !staffChatId) return;
  try {
    after(() => sendOrderAlert(order));
  } catch (error) {
    console.error("Telegram order alert not scheduled", errorName(error));
  }
}
