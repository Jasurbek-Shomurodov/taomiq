/**
 * Points Fontconfig at the fonts bundled in the repo, for the order alert image.
 *
 * Side-effect module: it must be evaluated before `sharp` is loaded. libvips (through Pango) reads
 * Fontconfig when it initialises, so setting the variables inside the render function is too late on a
 * cold Vercel Linux function, and text would render as empty boxes.
 *
 * Server-only by reach: it is loaded only through the dynamic import in ./telegram.ts. It does not import
 * "server-only" itself so that scripts/preview-order-alert.mjs can run it under plain Node.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The brand pair, as on the site: Manrope for text, Noto Serif Display for the order number and total. */
export const ALERT_FONT_SANS = "Manrope";
export const ALERT_FONT_SERIF = "Noto Serif Display";
export const ALERT_FONT_DIRECTORY = join(process.cwd(), "src", "assets", "fonts");
// Static instances only: weight selection from a variable font depends on the Pango build.
export const ALERT_FONT_FILES = [
  "Manrope-Regular.ttf",
  "Manrope-Bold.ttf",
  "Manrope-ExtraBold.ttf",
  "NotoSerifDisplay-Medium.ttf",
] as const;

const configDirectory = join(tmpdir(), "taomiq-fontconfig");
const cacheDirectory = join(tmpdir(), "taomiq-font-cache");
const configPath = join(configDirectory, "fonts.conf");

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
}

// Only the bundled directory is listed, so no system font can stand in. Each family falls back to the
// other: Manrope has no ʻ (Uzbek Latin) and no Қ Ғ Ҳ (Uzbek Cyrillic); Noto Serif Display has all three.
mkdirSync(configDirectory, { recursive: true });
mkdirSync(cacheDirectory, { recursive: true });
writeFileSync(
  configPath,
  `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${escapeXml(ALERT_FONT_DIRECTORY)}</dir>
  <cachedir>${escapeXml(cacheDirectory)}</cachedir>
  <alias>
    <family>${ALERT_FONT_SANS}</family>
    <prefer><family>${ALERT_FONT_SANS}</family><family>${ALERT_FONT_SERIF}</family></prefer>
  </alias>
  <alias>
    <family>${ALERT_FONT_SERIF}</family>
    <prefer><family>${ALERT_FONT_SERIF}</family><family>${ALERT_FONT_SANS}</family></prefer>
  </alias>
</fontconfig>`,
);

process.env.FONTCONFIG_FILE = configPath;
process.env.FONTCONFIG_PATH = configDirectory;
// Linux already uses Fontconfig. On macOS Pango would use CoreText and the system fonts instead, so a
// local preview would not show the bundled fonts production uses.
process.env.PANGOCAIRO_BACKEND = "fc";
