// Renders a sample order alert card to a PNG, so the design can be checked without placing an order.
// Usage: node scripts/preview-order-alert.mjs <output.png>
// Sends nothing and reads no environment variables. Needs Node 22.18+ (runs the TypeScript renderer directly).
import { writeFileSync } from "node:fs";
import { register } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const output = process.argv[2];
if (!output) {
  console.error("Usage: node scripts/preview-order-alert.mjs <output.png>");
  process.exit(1);
}
const target = resolve(output);

// The renderer finds the bundled fonts from the project root, as it does on Vercel.
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));

// The app's TypeScript imports omit the ".ts" extension; add it for relative imports.
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (/^\\.{1,2}\\//.test(specifier) && !/\\.[cm]?[jt]s$/.test(specifier)) {
        try { return await next(specifier + ".ts", context); } catch {}
      }
      return next(specifier, context);
    }
  `)}`,
);

const { renderOrderAlertPng, orderAlertCaption } = await import("../src/lib/order/alertImage.ts");

const sample = {
  number: 1001,
  programName: "BALANCE",
  tagColor: "#C7A86B",
  kcal: 1800,
  days: 2,
  weekdaysOnly: false,
  startDate: "2026-11-25",
  window: "07:00–09:00",
  pricePerDay: 281000,
  total: 562000,
  locale: "uz",
};

writeFileSync(target, await renderOrderAlertPng(sample));
console.log(`Caption: ${orderAlertCaption(sample)}`);
console.log(`Wrote ${target}`);
