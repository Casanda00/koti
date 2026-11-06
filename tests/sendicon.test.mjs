// The add box's round button: + when the box is empty (it opens the add sheet), a send arrow once something is
// typed (6 November 2026). Checked in a browser for typing, clearing, sending and saving; these keep the wiring.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("there is a send icon to switch to", () => {
  assert.match(read("index.html"), /<symbol id="i-send"/);
});
test("the button follows what is typed, and every way the box is emptied", () => {
  const c = read("js/composer.js");
  assert.match(c, /input\.addEventListener\("input", goIcon\)/, "on every keystroke");
  assert.match(c, /typed \? "#i-send" : "#i-plus"/);
  assert.match(c, /Promise\.resolve\(r\)\.finally\(goIcon\)/, "after sending, once the AI has answered");
  assert.equal((c.match(/input\.value = ""; goIcon\(\);/g) || []).length, 2, "after the confirm sheet saves or opens the details");
  assert.match(c, /else \{ if \(busy\.ph\) input\.placeholder = busy\.ph; goIcon\(\); \}/, "when the AI stops working");
});
