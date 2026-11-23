import "server-only";
import { after } from "next/server";
import { formatDay } from "@/lib/admin/orders";

/**
 * Optional Telegram alert to the staff chat on each new order.
 * Off unless both variables are set. The message carries no name, phone or address: those stay in the
 * admin, behind the owner's login. A failed alert never fails the order, and its text is never logged.
 */
const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
const staffChatId = process.env.TELEGRAM_STAFF_CHAT_ID ?? "";

export type OrderAlert = {
  number: number;
  programName: string;
  kcal: number;
  days: number;
  weekdaysOnly: boolean;
  startDate: string; // YYYY-MM-DD
  window: string;
  locale: string;
};

function alertText(order: OrderAlert): string {
  return [
    `Новый заказ № ${order.number}`,
    `${order.programName} / ${order.kcal} ккал · ${order.days} дн., ${order.weekdaysOnly ? "только будни" : "каждый день"}`,
    `Старт: ${formatDay(order.startDate)} · ${order.window}`,
    `Язык сайта: ${order.locale}`,
    "Клиент и телефон — в админке, раздел «Заказы».",
  ].join("\n");
}

async function sendOrderAlert(order: OrderAlert): Promise<void> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: staffChatId, text: alertText(order) }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    // Status only: the response body echoes the message, and the URL holds the bot token.
    if (!response.ok) console.error("Telegram order alert failed", response.status);
  } catch (error) {
    console.error("Telegram order alert failed", error instanceof Error ? error.name : "unknown error");
  }
}

/** Sends the alert after the response is sent. Never throws. */
export function scheduleOrderAlert(order: OrderAlert): void {
  if (!botToken || !staffChatId) return;
  try {
    after(() => sendOrderAlert(order));
  } catch (error) {
    console.error("Telegram order alert not scheduled", error instanceof Error ? error.name : "unknown error");
  }
}
