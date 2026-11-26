import "server-only";
import { isOrderingConfigured } from "@/lib/supabase/secret";

/*
 * The owner group's Telegram messages (docs/plans/zarkebab-feature-port.md, slice 9a) read three variables. Their
 * values never leave the server; Settings shows only whether each is set, by name.
 *   TELEGRAM_BOT_TOKEN       the bot (the same one as the staff order alert, src/lib/order/telegram.ts)
 *   TELEGRAM_OWNER_CHAT_ID   the owner/investor group; the bot is a member there. While it is not set the messages
 *                            go to the staff order-alert group (TELEGRAM_STAFF_CHAT_ID): the owner asked for one
 *                            group for now. Everyone in that group then sees the switched-on kinds.
 *   CRON_SECRET              protects the daily endpoint (src/app/api/telegram/daily/route.ts)
 * The outbox itself is read and written with the server's secret key (SUPABASE_SECRET_KEY).
 */

export const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const telegramOwnerChatId = process.env.TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_STAFF_CHAT_ID || "";
/** Whether the owner group has its own chat id; false while the staff group stands in. Settings shows this. */
export const hasOwnOwnerChat = Boolean(process.env.TELEGRAM_OWNER_CHAT_ID);
export const cronSecret = process.env.CRON_SECRET ?? "";

/** Messages can be delivered: the bot, the owner's chat and the secret key are all set. */
export const isOwnerTelegramConfigured = Boolean(telegramBotToken && telegramOwnerChatId && isOrderingConfigured);

/** The daily endpoint can run: its secret is set. */
export const isDailyEndpointConfigured = Boolean(cronSecret);
