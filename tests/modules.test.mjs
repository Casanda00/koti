// Everything one module of the app imports from another exists. A missing export stops the whole app at start-up
// with a blank screen, and no other test loads every screen: it happened once while removing Today's old mood code.
// The imports are read from the source, so modules that need a real page (app.js, theme.js, share.js) are checked
// without running them.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import "./_env.mjs";

const dir = new URL("../js/", import.meta.url), needsPage = new Set(["app.js", "theme.js", "share.js"]);
const files = readdirSync(dir).filter(f => f.endsWith(".js"));
const exportsOf = async f => Object.keys(await import(new URL(f, dir)));

for (const f of files) {
  test(`js/${f}: every name it imports exists`, async () => {
    const src = readFileSync(new URL(f, dir), "utf8");
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/([\w./-]+)"/g)) {
      const names = m[1].split(",").map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean), from = m[2];
      if (needsPage.has(from)) continue;
      const have = await exportsOf(from);
      for (const n of names) assert.ok(have.includes(n), `${f} imports ${n} from ${from}, which doesn't export it`);
    }
    if (!needsPage.has(f)) await assert.doesNotReject(import(new URL(f, dir)));
  });
}
