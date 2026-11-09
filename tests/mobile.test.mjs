// Getting Koti ready to be an iPhone app (Capacitor, 9 November 2026): the app copy holds exactly the app, the
// iPhone asks for the microphone and camera with words (without them iOS closes the app), the web-only parts step
// aside in the app, links in emails lead to the website, and an account can be deleted in the app (App Store rule).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import "./_env.mjs";
import { build, APP_FILES } from "../tools/build-app.mjs";
const P = await import("../js/platform.js");
const root = new URL("../", import.meta.url);
const read = f => readFileSync(new URL(f, root), "utf8");

test("the app copy is the app: everything the page loads, and none of the repository's own files", () => {
  const out = build();
  for (const f of ["index.html", "js", "css", "fonts", "icons", "manifest.webmanifest"]) assert.ok(out.includes(f), f);
  for (const f of ["tests", "supabase", "tools", "node_modules", "ios", "README.md", "package.json"]) assert.ok(!out.includes(f), `${f} isn't part of the app`);
  for (const m of read("index.html").matchAll(/(?:src|href)="((?:js|css|fonts|icons)\/[^"#?]+)"/g)) assert.ok(existsSync(new URL(`../www/${m[1]}`, import.meta.url)), `${m[1]} is in the app`);
  assert.deepEqual([...APP_FILES].sort(), [...out].sort());
});

test("the iPhone asks for the microphone, camera and photos with words, and only upright", () => {
  const plist = read("ios/App/App/Info.plist");
  for (const k of ["NSMicrophoneUsageDescription", "NSCameraUsageDescription", "NSPhotoLibraryUsageDescription"]) assert.match(plist, new RegExp(`<key>${k}</key>\\s*<string>[^<]{10,}</string>`), k);
  assert.match(plist, /<key>UISupportedInterfaceOrientations<\/key>\s*<array>\s*<string>UIInterfaceOrientationPortrait<\/string>\s*<\/array>/);
  const cfg = JSON.parse(read("capacitor.config.json"));
  assert.equal(cfg.webDir, "www");
  assert.equal(cfg.appName, "Koti");
});

test("on the website nothing changes; in the app, email links lead to the website", () => {
  assert.equal(P.isNative(), false);
  window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "ios" };
  assert.equal(P.isNative(), true);
  assert.equal(P.platform(), "ios");
  assert.equal(P.returnURL(), P.WEB_URL, "capacitor://localhost isn't an address an email can open");
  delete window.Capacitor;
});

test("the web-only parts step aside in the app", () => {
  assert.match(read("js/app.js"), /!isNative\(\) && "serviceWorker" in navigator/);
  assert.match(read("js/install.js"), /if \(isNative\(\)\) return false;/);
  assert.match(read("js/push.js"), /!isNative\(\) && "serviceWorker"/);
  assert.match(read("js/update.js"), /if \(isNative\(\)\) return;/);
});

test("an account can be deleted in the app, and the server function for it is in the repository", () => {
  assert.match(read("js/more.js"), /data-act="deleteAccount"/);
  assert.match(read("js/more.js"), /invoke\("delete-account", \{ body: \{ confirm: "DELETE" \} \}\)/);
  assert.match(read("supabase/functions/delete-account/index.ts"), /confirm !== "DELETE"/);
  assert.match(read("supabase/config.toml"), /\[functions\.delete-account\]/);
  assert.match(read("privacy.html"), /Delete account/);
});
