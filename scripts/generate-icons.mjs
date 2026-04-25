/**
 * Rasterize PWA icon SVGs to PNG.
 *
 * Inputs (from `public/icons/`):
 *   - 192.svg
 *   - 512.svg
 *   - maskable-512.svg
 *
 * Outputs (alongside the SVGs):
 *   - 192.png        (homescreen icon, transparent rounded square)
 *   - 512.png        (high-res homescreen icon)
 *   - maskable-512.png (full-bleed; safe zone is the inner 80% circle)
 *
 * Why PNG: iOS Safari "Add to Home Screen" still resolves
 * `apple-touch-icon` PNGs more reliably than SVG across iOS 14–17.
 * Android Chrome accepts both, but PNG is the canonical PWA icon
 * format per the W3C web app manifest spec.
 *
 * Re-run as needed:
 *   node scripts/generate-icons.mjs
 *
 * Uses `sharp` — already a transitive dependency of Next.js for the
 * built-in image optimizer, so no extra install cost. If `sharp` ever
 * becomes optional, prefer `@resvg/resvg-js` (zero-dep WASM) over
 * adding a new direct dep.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = resolve(__dirname, "..", "public", "icons");

const TARGETS = [
  { svg: "192.svg", png: "192.png", size: 192 },
  { svg: "512.svg", png: "512.png", size: 512 },
  { svg: "maskable-512.svg", png: "maskable-512.png", size: 512 },
];

async function rasterize({ svg, png, size }) {
  const svgPath = join(ICONS_DIR, svg);
  const pngPath = join(ICONS_DIR, png);
  const svgBuffer = await readFile(svgPath);
  // density:512 ensures the SVG is sampled at high enough resolution
  // before being scaled down to `size` — eliminates aliasing on
  // diagonal strokes at 192px.
  const out = await sharp(svgBuffer, { density: 512 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(pngPath, out);
  return { png, bytes: out.byteLength };
}

const results = await Promise.all(TARGETS.map(rasterize));
for (const r of results) {
  console.log(`  ${r.png}  ${r.bytes.toLocaleString()} bytes`);
}
