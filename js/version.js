// Shown in More so you can check which version of Koti a device is running, and how a phone knows there's a new one
// (update.js compares it with the published file). Must match VERSION in sw.js: tests/versions.test.mjs fails if not.
// It stayed at 2026-11-09-50 through five releases (sw.js went to -55), so phones never heard of them (14 November 2026).
export const APP_VERSION = "2026-11-14-59";
