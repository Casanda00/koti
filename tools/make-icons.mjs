// Draws Koti's icons from its wordmark, so they're made the same way every time. Chosen 10 November 2026: "koti"
// in Archivo, heavy and narrow, with the dot of the i as a light left on at home. White on lake blue for the icon;
// ink on birch white for the splash.
//   node tools/make-icons.mjs      (needs Playwright with Chromium; not part of the app or the tests.
//   Installed globally? NODE_PATH="$(npm root -g)" node tools/make-icons.mjs)
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)("playwright");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Koti's own copy of the font, inlined so the page needs no network or file access.
const font = "data:font/woff2;base64," + readFileSync(join(root, "fonts/archivo-latin.woff2")).toString("base64");

export const BLUE = "#2442D6", BIRCH = "#F7F8F6", INK = "#15161A", LAMP_ON_BLUE = "#FF9C4A", LAMP = "#E0761A";

/* The wordmark: "kot" and a dotless i whose dot is a lamp. `size` is the font size in px. */
export const wordmark = (size, ink, lamp) => `<div style="font:900 ${size}px/0.8 Archivo;font-stretch:62%;letter-spacing:-0.01em;color:${ink}">kot<span style="position:relative;display:inline-block">ı<span style="position:absolute;left:50%;top:-0.02em;width:0.15em;height:0.15em;margin-left:-0.075em;border-radius:0.02em;background:${lamp}"></span></span></div>`;

/* Each file: its size, its ground, and how large the word is against the square. */
const ICONS = [
  { file: "icons/icon-512.png", px: 512, bg: BLUE, ink: "#fff", lamp: LAMP_ON_BLUE, scale: 0.42 },
  { file: "icons/icon-192.png", px: 192, bg: BLUE, ink: "#fff", lamp: LAMP_ON_BLUE, scale: 0.44 },
  { file: "icons/apple-touch-icon.png", px: 180, bg: BLUE, ink: "#fff", lamp: LAMP_ON_BLUE, scale: 0.42 },
  // Android crops a maskable icon to a circle: the word stays inside the middle 80%.
  { file: "icons/icon-maskable-512.png", px: 512, bg: BLUE, ink: "#fff", lamp: LAMP_ON_BLUE, scale: 0.34 },
  { file: "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png", px: 1024, bg: BLUE, ink: "#fff", lamp: LAMP_ON_BLUE, scale: 0.42 },
  ...["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"].map(f =>
    ({ file: `ios/App/App/Assets.xcassets/Splash.imageset/${f}`, px: 2732, bg: BIRCH, ink: INK, lamp: LAMP, scale: 0.15 })),
];

const page = (i) => `<!doctype html><html><head><style>
@font-face{font-family:Archivo;font-weight:300 900;font-stretch:62% 125%;src:url(${font}) format("woff2")}
html,body{margin:0}body{width:${i.px}px;height:${i.px}px;background:${i.bg};display:flex;align-items:center;justify-content:center}
</style></head><body>${wordmark(Math.round(i.px * i.scale), i.ink, i.lamp)}</body></html>`;

const browser = await chromium.launch();
const p = await browser.newPage({ deviceScaleFactor: 1 });
for (const i of ICONS) {
  await p.setViewportSize({ width: i.px, height: i.px });
  await p.setContent(page(i));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: join(root, i.file), omitBackground: false });
  console.log(i.file, i.px);
}
await browser.close();
