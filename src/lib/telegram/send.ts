import "server-only";

/*
 * One plain-text Telegram message, with the timeout of the staff order alert (src/lib/order/telegram.ts, 5 s for text)
 * and its rule for what a failure means. The order alert keeps its own code; this is the outbox's sender.
 *
 *   sent       Telegram answered 2xx.
 *   retry      surely not delivered, worth trying again: 429 (rate limit), or the connection was refused before the
 *              request went out (DNS, refused, unreachable, connect timeout).
 *   failed     surely not delivered and trying again will not help: any other 4xx (wrong chat id, bot not in the
 *              group, bad token).
 *   uncertain  maybe delivered: a timeout after the request went out, a 5xx, or a connection lost mid-request. Never
 *              sent again by itself; the owner can resend from Settings.
 *
 * Only the status code and an error code are kept (as a short code for the outbox): the response body echoes the
 * message and the URL holds the bot token, so neither is logged.
 */

export type SendOutcome = {
  result: "sent" | "retry" | "failed" | "uncertain";
  code: string | null;
  /** On a 429: how many seconds Telegram asked to wait (parameters.retry_after), when it said. */
  retryAfter?: number;
};

export const SEND_TIMEOUT_MS = 5000;

/** Network errors that happen before a request is written: nothing reached Telegram. */
const NOT_SENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function causeCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** What an HTTP status means for the message. */
export function classifyStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return { result: "sent", code: null };
  if (status === 429) return { result: "retry", code: "http_429" };
  if (status >= 400 && status < 500) return { result: "failed", code: `http_${status}` };
  return { result: "uncertain", code: `http_${status}` };
}

/** What a thrown fetch error means for the message. */
export function classifyError(error: unknown): SendOutcome {
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return { result: "uncertain", code: "timeout" };
  const code = causeCode(error);
  if (code && NOT_SENT_CODES.has(code)) return { result: "retry", code: `net_${code}`.slice(0, 60) };
  return { result: "uncertain", code: code ? `net_${code}`.slice(0, 60) : "network" };
}

/** parameters.retry_after of a 429 answer, a whole number of seconds 1..86400, or null. Never throws. */
async function readRetryAfter(response: Response): Promise<number | null> {
  try {
    const body = (await response.json()) as { parameters?: { retry_after?: unknown } } | null;
    const value = Number(body?.parameters?.retry_after);
    return Number.isInteger(value) && value >= 1 && value <= 86_400 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Sends `text` to `chatId`. Never throws. `fetchImpl` is for checks without the network (the outbox's tests use a
 * stub; nothing here ever reaches Telegram in tests).
 */
export async function sendTelegramText(
  botToken: string,
  chatId: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SendOutcome> {
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Plain text: no parse_mode, so names typed by staff cannot break or inject formatting.
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const outcome = classifyStatus(response.status);
    if (response.status === 429) {
      // A 429's body holds no message text, only how long to wait: { ok, error_code, description, parameters }.
      const retryAfter = await readRetryAfter(response);
      return retryAfter === null ? outcome : { ...outcome, retryAfter };
    }
    // Any other body is not read: it echoes the message. Release the connection.
    await response.body?.cancel().catch(() => {});
    return outcome;
  } catch (error) {
    return classifyError(error);
  }
}
