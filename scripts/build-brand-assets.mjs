// Builds the raster brand assets from the approved logo (src/assets/brand/taomiq-logo.jpg, 1254 × 1254).
// Usage: node scripts/build-brand-assets.mjs
// Runs at author time, not at build time; the outputs are committed. Deterministic: re-running it on the
// same source writes the same files. Measurements below are in source pixels.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(root, "src/assets/brand/taomiq-logo.jpg");

// The gold ring: centre and outer radius (it is very slightly taller than wide in the source).
const RING = { cx: 624.5, cy: 433.5, outer: 262 };
// Everything that is drawn: ring top to tagline baseline, tagline left to right.
const CONTENT = { left: 205, top: 172, right: 1047, bottom: 979 };

// Brand tokens, src/app/globals.css.
const GOLD = [0xc7, 0xa8, 0x6b];
const IVORY = [0xf6, 0xf1, 0xe8];

const out = (path) => {
  const target = resolve(root, path);
  mkdirSync(dirname(target), { recursive: true });
  return target;
};

/**
 * The logo's own background colour, averaged along the inside edge of `box`, so padding added around
 * that crop shows no seam (the JPG background is not perfectly flat: the corners are a shade darker).
 */
async function backgroundColour(box) {
  const { data, info } = await sharp(SOURCE).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  let n = 0;
  const depth = 4;
  for (let y = box.top; y < box.top + box.height; y++) {
    for (let x = box.left; x < box.left + box.width; x++) {
      const edge =
        y < box.top + depth || y >= box.top + box.height - depth || x < box.left + depth || x >= box.left + box.width - depth;
      if (!edge) continue;
      const i = (y * info.width + x) * info.channels;
      for (let c = 0; c < 3; c++) sum[c] += data[i + c];
      n++;
    }
  }
  return sum.map((v) => Math.round(v / n));
}

/** Square crop around the ring with a little forest margin. */
function monogramBox(margin) {
  const half = Math.round(RING.outer * (1 + margin));
  return { left: Math.round(RING.cx - half), top: Math.round(RING.cy - half), width: half * 2, height: half * 2 };
}

// Indexed PNG: a fraction of the size of a truecolour PNG of a JPG crop, with no visible loss.
const PNG = { compressionLevel: 9, palette: true, quality: 95, effort: 10 };

const monogram = (size, margin = 0.1) =>
  sharp(SOURCE).extract(monogramBox(margin)).resize(size, size, { kernel: "lanczos3" });

/** A .ico holding PNG images (supported by every current browser; decoders expect them RGBA). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

/**
 * The monogram with the background removed and recoloured to the brand tokens, so it sits on the
 * alert card's forest header (a slightly different green from the JPG) without a visible square.
 */
async function monogramKnockout(size, background) {
  const { data, info } = await monogram(size, 0.02).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
  const bgLum = lum(...background);
  const full = 190 - bgLum; // the gold ring's luminance; ivory is brighter and saturates
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let p = 0; p < info.width * info.height; p++) {
    const [r, g, b] = [data[p * 3], data[p * 3 + 1], data[p * 3 + 2]];
    const alpha = Math.max(0, Math.min(1, (lum(r, g, b) - bgLum) / full));
    // Un-blend from the background to tell gold (saturated) from ivory (neutral).
    const fg = [r, g, b].map((v, c) => (alpha > 0 ? (v - (1 - alpha) * background[c]) / alpha : 0));
    const colour = fg[0] - fg[2] > 70 ? GOLD : IVORY;
    rgba.set([...colour, Math.round(alpha * 255)], p * 4);
  }
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png(PNG);
}

const files = [];
const write = async (path, image) => {
  const target = out(path);
  await image.toFile(target);
  files.push(path);
};

// Favicon set: Next.js serves these from src/app by file convention.
await write("src/app/icon.png", monogram(512).png(PNG));
await write("src/app/apple-icon.png", monogram(180).png(PNG));
const icoImages = [];
for (const size of [16, 32, 48]) icoImages.push({ size, data: await monogram(size, 0.04).ensureAlpha().png().toBuffer() });
writeFileSync(out("src/app/favicon.ico"), ico(icoImages));
files.push("src/app/favicon.ico");

// Absolute-URL logo (JSON-LD Organization.logo).
await write("public/brand/logo-512.png", monogram(512).png(PNG));

// Share image, 1200 × 630: the full logo centred, padded with its own background colour.
// In the [locale] segment, not the app root: that layout sets `openGraph` and `metadataBase`, and a parent
// segment's image would be dropped by the child's `openGraph` and resolved without the site's base URL.
{
  const margin = 56;
  const box = {
    left: CONTENT.left - margin,
    top: CONTENT.top - margin,
    width: CONTENT.right - CONTENT.left + margin * 2,
    height: CONTENT.bottom - CONTENT.top + margin * 2,
  };
  const height = 560;
  const [r, g, b] = await backgroundColour(box);
  const logo = await sharp(SOURCE).extract(box).resize({ height, kernel: "lanczos3" }).toBuffer({ resolveWithObject: true });
  const share = sharp(logo.data)
    .extend({
      top: Math.floor((630 - height) / 2),
      bottom: Math.ceil((630 - height) / 2),
      left: Math.floor((1200 - logo.info.width) / 2),
      right: Math.ceil((1200 - logo.info.width) / 2),
      background: { r, g, b },
    })
    .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" });
  await write("src/app/[locale]/opengraph-image.jpg", share.clone());
  await write("src/app/[locale]/twitter-image.jpg", share.clone());
}

// Telegram order alert card header (src/lib/order/alertImage.ts).
await write("src/assets/brand/monogram-alert.png", await monogramKnockout(128, await backgroundColour(monogramBox(0.02))));

for (const file of files) console.log(`Wrote ${file}`);
