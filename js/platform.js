// Where Koti is running: the website (a browser, or added to the Home Screen) or the phone app (Capacitor).
// In the phone app some web-only parts step aside: the Home Screen prompts, the service worker (the app's files are
// inside the app), web push, and checking the website for a newer version (the App Store updates the app).
// Links in emails (confirm your address, reset your password) always open the website: the app has no address of
// its own on the web until universal links are set up (MOBILE.md).
export const WEB_URL = "https://casanda00.github.io/koti/";
export const isNative = () => { try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch { return false; } };
export const platform = () => { try { return isNative() ? window.Capacitor.getPlatform() : "web"; } catch { return "web"; } };
/* Where a link in an email should bring the person back to. */
export const returnURL = () => (isNative() ? WEB_URL : location.origin + location.pathname);
