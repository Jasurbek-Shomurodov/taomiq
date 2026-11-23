# Plan · Order alert as an image

Status: approved for build, 23 Nov 2026. Extends slice 2 of [order-requests.md](order-requests.md).

## Goal

The Telegram alert for a new order arrives as a branded card image instead of plain text, made the same way as the report images in the owner's other projects (Game Club daily finance report, Zar Kebab review digest): **an SVG string built in code, rasterised to PNG with `sharp`, using fonts bundled in the repo, sent with Telegram `sendPhoto`**. If the image cannot be made or sent, the current text message is sent instead. An order is never failed or slowed by the alert.

## Reference implementations (read before building; do not import from them)

- `/Users/Jasurbek_Shomurodov/Desktop/game-club-finance/src/lib/telegram/reportFontConfig.ts` — writes a Fontconfig file pointing at the bundled fonts and sets `FONTCONFIG_FILE` / `FONTCONFIG_PATH`. **It must be evaluated before `sharp` is imported**; on a cold Vercel Linux function, setting it later is too late and text renders as boxes.
- `/Users/Jasurbek_Shomurodov/Desktop/game-club-finance/src/lib/telegram/dailyFinanceReportImage.ts` — SVG building, `escapeXml`, the font-presence assertion, `sharp(Buffer.from(svg)).png()`.
- `/Users/Jasurbek_Shomurodov/Desktop/game-club-finance/src/lib/telegram/sendDailyFinanceReport.ts` (search `sendPhoto`) — multipart `FormData` upload with a caption and the text fallback.
- That repo's `next.config.*` — how the font files are forced into the serverless bundle (`outputFileTracingIncludes` or equivalent). Check this version's docs in `node_modules/next/dist/docs/` for the current option name, and whether `sharp` needs `serverExternalPackages`.
- `/Users/Jasurbek_Shomurodov/Desktop/zar-kebab-pos/api/google-reviews/_lib/dailyDigestImage.js` — `drawableText()` (drops characters the font cannot draw) and text wrapping.

## Architecture

| Piece | Where |
|---|---|
| Fontconfig setup (side-effect module, imported first) | `src/lib/order/alertFontConfig.ts` |
| Card renderer `renderOrderAlertPng(input): Promise<Buffer>` | `src/lib/order/alertImage.ts` |
| Sender: try `sendPhoto` with the PNG, fall back to `sendMessage` | `src/lib/order/telegram.ts` (existing) |
| Fonts (TTF, with Cyrillic and Latin incl. `ʻ`) | `src/assets/fonts/` |
| Bundle inclusion of the fonts for the order route | `next.config.ts` |

- `sharp` becomes a direct dependency (same major as the reference projects).
- All of this runs inside the existing `after()` callback in `scheduleOrderAlert()`, i.e. after the response is sent. Keep the 5 s timeout per Telegram request; rendering itself must not be able to hang the function (no network inside the renderer).
- `sharp` and the renderer are loaded with a dynamic `import()` inside the alert path, so the order action's cold start and its failure modes are unchanged when no bot token is set.
- Server-only. Nothing here is imported by client components.

## Data

No schema change, no migration. The renderer input is what `scheduleOrderAlert()` already receives, plus the money figures the action already has: order number, program name, program tag colour, kcal, days, weekdays-only flag, start date, delivery window, price per day, total, site locale.

**No personal data in the image or the caption** — no name, phone, address, comment or exclusions. Same rule as the text alert. The card ends with the pointer to the admin.

## Design rules

- Width 1200 px, height to fit content (about 1200 × 760), PNG.
- Brand tokens from `src/app/globals.css`: Deep Forest `#183c34` header band, Ivory `#f6f1e8` body, Gold `#c7a86b` accents, Graphite `#2d2d2a` text, Muted `#6b6b63` labels, Line `#d9d2c2` rules.
- Fonts: the brand pair — a serif for the wordmark, order number and total (Noto Serif Display), a sans for everything else (Manrope) — as static TTFs that include Cyrillic. If static TTFs with Cyrillic cannot be obtained for one of them, use Noto Sans (as the reference projects do) and say so in the report. Include the font licence file(s) next to the fonts.
- Layout, top to bottom:
  1. Header band: `TAOMIQ` wordmark left (the `IQ` in gold, as in `src/components/Logo.tsx`), label `НОВЫЙ ЗАКАЗ` and `№ 1001` right.
  2. Program line: a small dot in the program's tag colour, program name, `1800 ккал`.
  3. A two-column grid of facts with small uppercase labels: Срок (`2 дня`), Доставка (`каждый день` / `только будни`), Старт (`ср, 25 ноября`), Окно (`07:00–09:00`).
  4. Total block: `562 000 сум` large, `281 000 сум в день` beneath.
  5. Footer line, muted: `Клиент и телефон — в админке, раздел «Заказы»` and the site language.
- Russian only (staff language). Numbers with thin/regular spaces as the site formats them; dates in `Asia/Tashkent`.
- Every dynamic string goes through XML escaping; program names pass through a `drawableText`-style filter.
- Caption (plain text, short): `Новый заказ № 1001 · BALANCE 1800 ккал · 562 000 сум`. The fallback text message stays as it is today.

## Slices

1. **Image alert.** Fonts and licence, Fontconfig module, renderer, `sendPhoto` with fallback, bundle config, `sharp` dependency. Add a small script `scripts/preview-order-alert.mjs` (or `.ts` run with the repo's existing tooling) that renders a sample card to a PNG path given as an argument, so the design can be checked without placing an order. Leaves `main` working: with no bot token nothing changes; with one, the image is sent or the text fallback is.

## Risks and open questions

- **Fonts on Vercel.** The classic failure is tofu boxes or a missing-font error in production while local works. Mitigations: assert the font files exist before rendering (throw → text fallback), force them into the bundle, set Fontconfig before `sharp` loads. This cannot be proven until a production deployment sends an alert; the fallback keeps alerts working meanwhile.
- **Bundle size / cold start.** `sharp` adds a native binary to the order function. Dynamic import keeps it off the hot path.
- **Duplicate alerts (decided in review).** `sendPhoto` gets a 15 s timeout, and the text message is sent only when the photo surely did not arrive: rendering failed, or Telegram answered 4xx other than 429. On a timeout, network error, 429 or 5xx the error is logged and nothing more is sent, so staff may occasionally get no alert but never the same order twice.
- **Amounts (decided in review).** The card shows `price_per_day` and `total` read back from `public.orders` by `number` with the secret client inside the `after()` callback (only those two columns, no personal data), not figures recomputed from the cached catalogue, which can lag behind the prices `submit_order()` used. If the read fails the card shows "Сумма — в админке". Nothing is added to the request path.
- **Logging.** Same rule as before: on failure log only an HTTP status or error name, never the token, the URL, or message contents.
