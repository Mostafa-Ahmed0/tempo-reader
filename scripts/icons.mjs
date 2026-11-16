#!/usr/bin/env node
/**
 * Generates every icon from resources/icon.svg:
 *   public/favicon.svg, public/icons/*.png            (PWA manifest, favicon, apple-touch-icon)
 *   android/app/src/main/res/mipmap-* / drawable-*   (launcher icons incl. adaptive + themed, splash)
 * Run with `npm run icons` after changing the SVG. Uses sharp (dev dependency).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const master = fs.readFileSync(path.join(root, 'resources/icon.svg'), 'utf8');

const BG = '#111214';
const markMatch = master.match(/<g id="mark" transform=[\s\S]*<\/g>\s*(?=<\/svg>)/);
if (!markMatch) throw new Error('resources/icon.svg: <g id="mark"> not found');
const MARK = markMatch[0];

/** The mark at a given scale (master: 0.69), optionally recoloured to one colour (themed icon). */
function mark(scale, mono = null) {
  let g = MARK.replace(/scale\([\d.]+\)/, `scale(${scale})`);
  if (mono) g = g.replace(/stroke="#[0-9a-fA-F]{6}"/g, `stroke="${mono}"`).replace(/stroke-opacity="[\d.]+"/g, '');
  return g;
}

const svg = (body, w = 512, h = 512) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;

const variants = {
  // Rounded square, for browsers/desktop ("any" purpose).
  any: svg(`<rect width="512" height="512" rx="112" fill="${BG}"/>${mark(0.69)}`),
  // Full-bleed square for platforms that apply their own corner radius (apple-touch-icon, legacy Android).
  square: svg(`<rect width="512" height="512" fill="${BG}"/>${mark(0.69)}`),
  // Maskable: full bleed, content inside the 80 % safe circle.
  maskable: svg(`<rect width="512" height="512" fill="${BG}"/>${mark(0.56)}`),
  round: svg(`<circle cx="256" cy="256" r="256" fill="${BG}"/>${mark(0.6)}`),
  // Android adaptive icon layers (108 dp canvas, 66 dp guaranteed visible circle).
  foreground: svg(mark(0.46)),
  monochrome: svg(mark(0.46, '#ffffff')),
};

// Favicon: at 16–32 px a whole word is mush, so just the red focus "e" between its ticks.
const FAVICON = svg(
  `<rect width="512" height="512" rx="112" fill="${BG}"/>` +
    `<g fill="none" stroke-linecap="round" stroke-width="50" transform="translate(256 256)">` +
    `<path stroke="#ff4d4d" d="M-105 0 H105 A105 105 0 1 0 74.2 74.2"/>` +
    `<path stroke="#ece9e2" stroke-opacity="0.6" stroke-width="36" d="M0 -222 V-176 M0 176 V222"/>` +
    `</g>`,
);

async function png(svgText, size, out, { flatten = false } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let img = sharp(Buffer.from(svgText), { density: Math.max(72, (72 * size) / 512) * 2 }).resize(size, size);
  if (flatten) img = img.flatten({ background: BG });
  await img.png({ compressionLevel: 9 }).toFile(out);
  return out;
}

const written = [];

// ---------------------------------------------------------------- web / PWA
const pub = path.join(root, 'public');
fs.writeFileSync(path.join(pub, 'favicon.svg'), FAVICON + '\n');
written.push('public/favicon.svg');
for (const [name, v, size, opts] of [
  ['icon-192.png', 'any', 192],
  ['icon-512.png', 'any', 512],
  ['maskable-192.png', 'maskable', 192],
  ['maskable-512.png', 'maskable', 512],
  ['apple-touch-icon.png', 'square', 180, { flatten: true }],
]) {
  await png(variants[v], size, path.join(pub, 'icons', name), opts);
  written.push(`public/icons/${name}`);
}
await png(FAVICON, 32, path.join(pub, 'icons', 'favicon-32.png'));
written.push('public/icons/favicon-32.png');

// ---------------------------------------------------------------- Android
const res = path.join(root, 'android/app/src/main/res');
if (fs.existsSync(res)) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(densities)) {
    const dir = path.join(res, `mipmap-${d}`);
    await png(variants.square, Math.round(48 * k), path.join(dir, 'ic_launcher.png'));
    await png(variants.round, Math.round(48 * k), path.join(dir, 'ic_launcher_round.png'));
    await png(variants.foreground, Math.round(108 * k), path.join(dir, 'ic_launcher_foreground.png'));
    await png(variants.monochrome, Math.round(108 * k), path.join(dir, 'ic_launcher_monochrome.png'));
    written.push(`android/.../mipmap-${d}/ic_launcher{,_round,_foreground,_monochrome}.png`);
  }
  const anydpi = path.join(res, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpi, { recursive: true });
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;
  fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptive);
  fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptive);
  // The template's vector background would override our colour: remove it.
  for (const f of ['drawable/ic_launcher_background.xml', 'drawable-v24/ic_launcher_foreground.xml']) {
    const p = path.join(res, f);
    if (fs.existsSync(p)) fs.rmSync(p);
  }
  const values = path.join(res, 'values');
  fs.mkdirSync(values, { recursive: true });
  fs.writeFileSync(
    path.join(values, 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`,
  );
  written.push('android/.../mipmap-anydpi-v26/ic_launcher{,_round}.xml', 'android/.../values/ic_launcher_background.xml');

  // Splash (pre-Android-12 devices; 12+ draw the launcher icon on windowSplashScreenBackground).
  // Re-render every splash.png the Capacitor template ships, at its own size.
  for (const dir of fs.readdirSync(res)) {
    const p = path.join(res, dir, 'splash.png');
    if (!dir.startsWith('drawable') || !fs.existsSync(p)) continue;
    const { width, height } = await sharp(p).metadata();
    const s = (Math.min(width, height) * 0.5) / 548; // word ≈ half the short side
    const body =
      `<rect width="${width}" height="${height}" fill="${BG}"/>` +
      mark(s).replace(/translate\(256 256\)/, `translate(${width / 2} ${height / 2})`);
    await sharp(Buffer.from(svg(body, width, height))).png({ compressionLevel: 9 }).toFile(p + '.tmp');
    fs.renameSync(p + '.tmp', p);
    written.push(`android/.../${dir}/splash.png (${width}x${height})`);
  }
} else {
  console.log('android/ not found: skipped Android resources (run `npx cap add android` first).');
}

console.log(written.map((w) => `  ${w}`).join('\n'));
