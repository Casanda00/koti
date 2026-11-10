// Builds the folder the iPhone app is made from (www/), for Capacitor. Koti has no build step: the app is the files
// in this repository, served as they are by GitHub Pages. The phone app gets a copy of exactly those files, and
// nothing that isn't the app (tests, the server functions, tools, the repository's own files).
//   npm run app:build      then   npx cap sync ios      (on a Mac: npx cap open ios)
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), ".."), out = join(root, "www");
/* What the app is. Anything else stays out of the phone app. */
export const APP_FILES = ["index.html", "share.html", "manifest.webmanifest", "sw.js", "css", "js", "fonts", "icons"];

export function build() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const f of APP_FILES) {
    if (!existsSync(join(root, f))) throw new Error(`${f} is missing`);
    cpSync(join(root, f), join(out, f), { recursive: true });
  }
  return readdirSync(out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log("www/:", build().join(", "));
