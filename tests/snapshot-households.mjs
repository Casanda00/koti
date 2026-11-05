// Writes tests/households.snapshot.json: what the app showed for the 300 households in tests/_households.mjs.
// It was run once, on 5 November 2026, against the code before the screens moved onto js/engine.js (commit
// f045da1), so the snapshot is the old app's answers. Running it again records whatever the app says now, which
// is only right after a change whose new figures have been checked and explained.
//   node tests/snapshot-households.mjs
import { writeFileSync } from "node:fs";
import { setToday, app } from "./_env.mjs";
import { household, appFigures, SEEDS } from "./_households.mjs";
setToday("2027-03-10");
const A = await app();
const extra = { spentBetween: (await import("../js/spent.js")).spentBetween, dayShare: (await import("../js/receipt.js")).dayShare };
const out = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const today = household(A.store.model, seed); A.store.emit("local"); setToday(today);
  out.push({ seed, ...appFigures(A, today, extra) });
}
writeFileSync(new URL("./households.snapshot.json", import.meta.url), JSON.stringify(out, null, 0).replace(/\},\{"seed"/g, '},\n{"seed"') + "\n");
console.log(`${out.length} households written`);
