/**
 * Derives the two logo files the site ships from the artwork the client sent.
 *
 *   tools/pfc-source.jpg          474x474, the mark on a solid black square
 *     -> public/images/pfc-logo.png      474x414  RGBA, hexagon + lettering
 *     -> public/images/pfc-wordmark.png  474x118  RGBA, lettering only
 *
 * Both outputs are already committed, so this script is not part of the
 * build and nothing imports it. It is here so the assets have a provenance:
 * anyone can see how they were produced and regenerate them if the client
 * sends new artwork.
 *
 *   npm i -D sharp && node tools/build-logo.mjs
 *
 * sharp is not in package.json. It arrives transitively with Next, but a
 * script should not lean on another package's dependency, so install it
 * explicitly for the one run.
 *
 * ---------------------------------------------------------------------------
 * Why this is not just a crop
 *
 * The source is a JPEG: no alpha channel, the mark sitting on solid black.
 * Dropping it into the site as-is puts a black rectangle in the header, which
 * is 86% black over a photograph, and on the auth cards, which are #171717 —
 * so the logo's own background would show as a visible box on both.
 *
 * What makes it recoverable is that the artwork is light-on-black. A pixel of
 * an image composited over black is
 *
 *     result = colour * alpha + 0 * (1 - alpha) = colour * alpha
 *
 * which is exactly the premultiplied form. So the brightest channel of a
 * pixel is its alpha, and dividing the colour back out by that alpha recovers
 * the original. Black stays at alpha 0 and disappears; the red and white
 * artwork comes back at full strength with clean edges, including the
 * antialiasing, which a threshold-based cut-out would turn into a fringe.
 *
 * This only works because the backdrop is black. On any other colour the
 * equation has a second unknown and the alpha cannot be recovered.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SOURCE = path.join(HERE, "pfc-source.jpg");
const OUT_DIR = path.join(ROOT, "public", "images");

/** Alpha below this is treated as background when finding the text band. */
const BAND_FLOOR = 140;
/** Breathing room kept around the detected band, in pixels. */
const BAND_PADDING = 3;

/**
 * Turns a black-backed image into an RGBA one by reading the premultiplied
 * values back out. See the note above for why this is sound.
 */
function unpremultiplyOverBlack(rgb, width, height) {
  const out = Buffer.alloc(width * height * 4);

  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
    const r = rgb[i];
    const g = rgb[i + 1];
    const b = rgb[i + 2];

    // The brightest channel is the alpha: a fully opaque pixel has at least
    // one channel at full strength, and a pixel that is pure background has
    // all three at zero.
    const alpha = Math.max(r, g, b);

    if (alpha === 0) {
      // Transparent. Leave the colour at zero too, so no stray hue survives
      // in a pixel nothing will draw.
      o += 0;
    } else {
      const scale = 255 / alpha;
      out[o] = Math.min(255, Math.round(r * scale));
      out[o + 1] = Math.min(255, Math.round(g * scale));
      out[o + 2] = Math.min(255, Math.round(b * scale));
    }
    out[o + 3] = alpha;
  }

  return out;
}

/**
 * Finds the rows holding the lettering.
 *
 * Earlier this took the first run of rows above a fixed alpha, and clipped
 * the red "FIGHTING / FITNESS" strip, whose peak alpha is lower than the
 * white letters above it. It now takes the LONGEST run of rows whose peak
 * alpha clears the floor, which keeps the strip and the lettering together as
 * one band and ignores the hexagon's thin outline rows.
 */
function findTextBand(rgba, width, height) {
  const peak = new Array(height).fill(0);

  for (let y = 0; y < height; y++) {
    let best = 0;
    for (let x = 0; x < width; x++) {
      const alpha = rgba[(y * width + x) * 4 + 3];
      if (alpha > best) best = alpha;
    }
    peak[y] = best;
  }

  let bestStart = 0;
  let bestLength = 0;
  let start = -1;

  for (let y = 0; y <= height; y++) {
    const inBand = y < height && peak[y] > BAND_FLOOR;

    if (inBand && start === -1) start = y;
    else if (!inBand && start !== -1) {
      const length = y - start;
      if (length > bestLength) {
        bestLength = length;
        bestStart = start;
      }
      start = -1;
    }
  }

  if (bestLength === 0) throw new Error("no text band found in the source");

  const top = Math.max(0, bestStart - BAND_PADDING);
  const bottom = Math.min(height, bestStart + bestLength + BAND_PADDING);
  return { top, height: bottom - top };
}

/** Trims fully transparent rows and columns from the edges. */
function trimBounds(rgba, width, height) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error("the source is entirely transparent");
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function main() {
  const { data, info } = await sharp(SOURCE)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const rgba = unpremultiplyOverBlack(data, width, height);

  const raw = { raw: { width, height, channels: 4 } };
  await mkdir(OUT_DIR, { recursive: true });

  // The full mark: everything, trimmed to the artwork.
  const full = trimBounds(rgba, width, height);
  const fullPng = await sharp(rgba, raw).extract(full).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(path.join(OUT_DIR, "pfc-logo.png"), fullPng);

  // The wordmark: the lettering band only, trimmed the same way.
  const band = findTextBand(rgba, width, height);
  const bandPng = await sharp(rgba, raw)
    .extract({ left: 0, top: band.top, width, height: band.height })
    .toBuffer({ resolveWithObject: true });

  const bandTrim = trimBounds(
    bandPng.data,
    bandPng.info.width,
    bandPng.info.height,
  );
  const wordmarkPng = await sharp(bandPng.data, {
    raw: { width: bandPng.info.width, height: bandPng.info.height, channels: 4 },
  })
    .extract(bandTrim)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path.join(OUT_DIR, "pfc-wordmark.png"), wordmarkPng);

  // Logo.tsx hard-codes these so next/image reserves the right box; if they
  // ever change, SOURCES in that file has to change with them.
  const fullMeta = await sharp(fullPng).metadata();
  const wordMeta = await sharp(wordmarkPng).metadata();
  console.log(`pfc-logo.png      ${fullMeta.width}x${fullMeta.height}`);
  console.log(`pfc-wordmark.png  ${wordMeta.width}x${wordMeta.height}`);
  console.log("\nIf either size differs from SOURCES in src/components/Logo.tsx, update it there.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
