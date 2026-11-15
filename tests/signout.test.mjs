// Signing out, 15 November 2026: "I signed out and the app never signed out. I still see everything even though I
// clicked sign out and it acknowledged it." Signing out kept the data on the phone by design, and said "Signed out"
// without checking: the library keeps the session when the server call fails. Now it really ends the session on this
// device, and nothing of the account stays: only this device's own choices.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setToday, app } from "./_env.mjs";
setToday("2026-11-15");
await app();
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("sign out ends the session on this device even when the server can't be reached", () => {
  const s = read("js/sync.js");
  assert.match(s, /const \{ error \} = await sync\.client\.auth\.signOut\(\);\n  if \(error\) \{ const local = await sync\.client\.auth\.signOut\(\{ scope: "local" \}\); if \(local\.error\) throw local\.error; \}\n  sync\.user = null;/);
  const m = read("js/more.js");
  assert.match(m, /try \{ await signOut\(\); \} catch \(err\) \{ toast\(`Couldn't sign out:/, "never 'Signed out' when it didn't");
  assert.doesNotMatch(m, /Your data stays here/);
});

test("nothing of the account stays on the phone: only this device's own choices", async () => {
  const { clearAccountHere, KEEP_ON_SIGN_OUT } = await import("../js/more.js");
  // a stand-in for localStorage: its keys as own properties, removeItem not one of them
  const fake = { "koti.model": "{}", "koti.meta": "{}", "koti.chats": "[]", "koti.brief": "{}", "koti.listMemory": "{}", "koti.account.u2": "{}", "koti.beforeSignIn": "{}", "koti.auth": "token",
    "koti.consent": "{}", "koti.install": "{}", "koti.mode": "dark", "kotiSpeaks": "1", "other.app": "x" };
  Object.defineProperty(fake, "removeItem", { value: k => { delete fake[k]; }, enumerable: false });
  await clearAccountHere(fake);
  assert.deepEqual(Object.keys(fake).sort(), ["koti.consent", "koti.install", "koti.mode", "kotiSpeaks", "other.app"]);
  assert.ok(!KEEP_ON_SIGN_OUT.some(k => /model|meta|chat|account|brief|auth/.test(k)));
});

// Security review, 15 November 2026: a session that ends any other way than Sign out (expired or revoked, signed out on
// another device, the password changed) left the account's data on the phone, visible while signed out.
test("a session that ends without Sign out clears the account from the phone too, keeping only unsent changes aside", async () => {
  const s = read("js/sync.js");
  assert.match(s, /if \(!sync\.user && !leaving && store\.meta\.owner && \(event === "SIGNED_OUT" \|\| event === "INITIAL_SESSION"\)\) endedElsewhere\(\);/);
  assert.match(s, /export async function signOut\(\) \{\n  leaving = true;/, "Sign out in You clears the phone itself, after asking");
  const { sessionEnded } = await import("../js/leave.js");
  const mk = () => { const f = { "koti.model": "{}", "koti.meta": "{}", "koti.chats": "[]", "koti.auth": "t", "koti.consent": "{}" };
    Object.defineProperty(f, "removeItem", { value: k => { delete f[k]; }, enumerable: false }); return f; };
  let stashed = null;
  const store = { meta: { owner: "u1" }, stashAccount(o) { stashed = o; fake["koti.account." + o] = "{}"; } };
  let fake = mk();
  assert.deepEqual(await sessionEnded(store, false, fake), { owner: "u1", kept: false });
  assert.deepEqual(Object.keys(fake), ["koti.consent"], "nothing of the account"); assert.equal(stashed, null);
  fake = mk();
  assert.deepEqual(await sessionEnded(store, true, fake), { owner: "u1", kept: true });
  assert.deepEqual(Object.keys(fake).sort(), ["koti.account.u1", "koti.consent"], "unsent changes kept aside for that account, nothing shown");
  assert.equal(await sessionEnded({ meta: { owner: null } }, false, mk()), null, "no account's data here: nothing to do");
  assert.match(read("js/app.js"), /You were signed out, so your data was removed from this phone/);
});
