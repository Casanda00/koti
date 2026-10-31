# Koti

A phone-first app for setting up a new home and, in later steps, planning money. It installs to the home screen from the browser, works offline, and syncs between devices through Supabase.

**Open it:** https://casanda00.github.io/koti/

## How it fits together

| Part | Where |
|---|---|
| App (screens, logic) | This repository, served by GitHub Pages. Plain HTML, CSS and JavaScript modules; no build step. |
| Data | Supabase project `koti` (`dghcrcneikxuaacsyhpy`): tables `lists`, `items`, `settings`, `categories`, `transactions`, `bills`, `goals`, each locked to the signed-in user with row level security. |
| Receipts | Private Storage bucket `receipts`; each user can only reach `{user id}/…`. Read on the device with Tesseract (English + Finnish), bundled in `js/vendor/tesseract-7.0.0/` and loaded only when scanning. |
| Database changes | `supabase/migrations/`. Applied through the Supabase connector; the optional `Update database` workflow applies them too if its secrets are set. |

## Files

| Path | What it is |
|---|---|
| `index.html` | App shell: sidebar (wide screens), tab bar (phones), sheet layer |
| `css/app.css` | Design tokens, light and dark themes, phone and desktop layouts |
| `js/data.js` | Data model, migrations from earlier versions, local store and change queue |
| `js/sync.js` | Sign-in and sync with Supabase: offline queue, pulls by server timestamp, live updates |
| `js/setup.js` | Home setup view: floor plan, progress, lists, swipe actions, item and add sheets |
| `js/more.js` | Account, month settings, lists and rooms, import, backup, install help |
| `js/charts.js` | Floor plans and charts |
| `js/money.js` | Money view: month summary, budgets with pace, spending by month, transactions, add/edit expense, categories |
| `js/plan.js` | Plan view: bills calendar, paid tracking (a payment is a transaction in the Bills category), autopay, savings goals |
| `js/receipts.js` | Receipts: shrink photos, read total/date/shop, keep on the device until uploaded, private viewing links |
| `js/ptr.js` | Pull down to refresh |
| `js/voice.js` | Speech input and the phrase parser (English and Finnish, digits or number words) |
| `js/config.js` | Supabase URL and publishable key (public by design) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and home-screen install. Bump `VERSION` in `sw.js` on each release. |

## Coming next

1. ~~App shell, sign-in and sync, Home setup~~
2. ~~Money: add expenses by typing or speaking, budgets, charts~~
3. Bank CSV import for any bank, category rules (on hold)
4. ~~Receipts: scan, store, read total and date~~
5. ~~Plan: bills calendar and savings goals~~
