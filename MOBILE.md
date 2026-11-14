# Koti as an iPhone app

> **Changed 14 November 2026:** once Koti moves to the lehgo-technology organisation, the app is rebuilt on the
> company's stack (Expo, React Native, TypeScript, EAS), in Koti's design, rather than shipped with Capacitor. The
> money engine and the Supabase backend carry over unchanged; the screens are rebuilt. The plan is the "Koti migration
> plan" doc, Phase 5. What follows records the Capacitor work, which stands until then: what Apple asks for (account
> deletion, privacy policy, permission wording, AI consent) applies to the new app just the same.

Decided 9 November 2026: Koti becomes an iPhone app with **Capacitor**. The same code runs inside a real app in the
App Store; the website keeps working as it is. Android comes after the iPhone.

## Where it stands

**Done (no Mac needed):**

- Capacitor 8 is set up: `capacitor.config.json`, the Xcode project in `ios/` (Swift Package Manager, no CocoaPods),
  and `npm run app:build`, which copies exactly the app's files into `www/` for the phone (`tools/build-app.mjs`).
- The iPhone asks for the microphone, camera and photos with a reason (`ios/App/App/Info.plist`). Without these iOS
  closes the app the moment it asks. Portrait only, like the website.
- Inside the app, the web-only parts step aside (`js/platform.js`): the Home Screen prompts, the service worker, web
  push, and checking the website for updates (the App Store updates the app).
- Links in emails (confirm your address, reset your password) open the website, which works, rather than the app's
  internal address, which an email can't open.
- **Delete account** in You. Apple rejects apps that let you make an account but not delete it in the app. The
  server function existed but nothing called it; it's now in the repository too (`supabase/functions/delete-account`).
- A public privacy policy page, `privacy.html` (https://casanda00.github.io/koti/privacy.html), which App Store
  Connect asks for. **Its contact address is a placeholder to fill in.**
- **Koti's logo** (chosen 10 November 2026): the word "koti", heavy and narrow, with the dot of the i as a light left
  on at home. White on lake blue for the app icon (1024 px, sharp), ink on birch white for the splash. Every icon is
  drawn by `tools/make-icons.mjs`; change the logo there and run it again.
- `tests/mobile.test.mjs` holds all of this in place.

## What's needed from you

| | Why |
|---|---|
| A Mac with Xcode 16 or later | To build, sign and upload the app. Everything up to here was done without one. |
| The app's name on the App Store | "Koti" may already be taken; a subtitle can carry the rest (e.g. "Koti: money and home"). |
| The bundle ID | Set to `io.github.casanda00.koti`. It can't change after the first upload, so change it now if you'd like your own domain in it. |
| A contact address for `privacy.html` | Apple and the EU both expect one. |
| App Store Connect: the app record, screenshots, description, category (Finance), age rating and the privacy answers | Done in your account. The privacy answers follow `privacy.html`: email address and financial information linked to you; photos and audio only when you use those features; nothing used for tracking. |

## Building on the Mac

```bash
npm ci                 # once
npm run app:sync       # copies the app into ios/ (after every change to the app)
npx cap open ios       # opens Xcode: choose your team under Signing, then run on your iPhone
```

To send it to testers: Xcode → Product → Archive → Distribute → TestFlight.

## Next, before submitting to the App Store

1. **Notifications.** Web push doesn't work inside an iPhone app, so reminders need Apple's own push (APNs):
   `@capacitor/push-notifications` in the app, an APNs key (.p8) from your Apple Developer account, and
   `send-reminders` sending to Apple as well as to browsers. Without this the app has no reminders. Reminders are
   also a large part of what makes it more than a website, which Apple's review looks for (guideline 4.2).
2. **Status bar and launch screen** in Koti's colours (`@capacitor/status-bar`, `@capacitor/splash-screen`).
3. **Words as you speak.** The iPhone app can't use the browser's speech recognition, so the live words while you
   hold the microphone won't show. Koti still hears you: the recording goes to the AI as before. A native speech
   plugin would bring the live words back, and the microphone without a connection.

## Later

- **Sharing a screenshot to Koti** from Photos needs an iOS share extension; the website's share target doesn't
  carry over to the app.
- **Email links opening the app** (universal links) need a file at the root of the website's domain. The website
  lives at `casanda00.github.io/koti/`, so that means the `casanda00.github.io` repository, or a domain of your own.
- **Android:** `npm i -D @capacitor/android && npx cap add android`, with a Google Play Console account ($25 once).

## App Store review: what's covered

- **Account deletion in the app** (guideline 5.1.1(v)): You → Delete account.
- **Personal data sent to a third-party AI** (5.1.2): asked once on each device, "Only necessary" or "Allow AI",
  and changeable in You → Privacy.
- **Sign in with Apple** isn't required: Koti signs in with email and password only, with no other company's login.
- **Minimum functionality** (4.2): the microphone, camera and AI are native-feeling already; reminders (above) make it
  clearer.
