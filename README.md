# Koti

A phone-first app for setting up a new home and, in later steps, planning money. It installs to the home screen from the browser, works offline, and syncs between devices through Supabase.

**Open it:** https://casanda00.github.io/koti/

## How it fits together

| Part | Where |
|---|---|
| App (screens, logic) | This repository, served by GitHub Pages. Plain HTML, CSS and JavaScript modules; no build step. |
| Data | Supabase project `koti` (`dghcrcneikxuaacsyhpy`): tables `lists` (shopping lists, projects and their room lists), `items`, `settings`, `categories`, `transactions`, `bills`, `goals`, `income_sources`, each locked to the signed-in user with row level security. |
| Receipts | Private Storage bucket `receipts`; each user can only reach `{user id}/…`. Read on the device with Tesseract (English + Finnish), bundled in `js/vendor/tesseract-7.0.0/` and loaded only when scanning. |
| Receipt reading | Edge Function `read-receipt` (`supabase/functions/read-receipt`): checks the signed-in user, counts the daily limit, sends the photo to OpenAI and returns shop, date, total and every line. Needs the secret `OPENAI_API_KEY`; optional `OPENAI_MODEL` and `AI_DAILY_LIMIT`. Without it, receipts are read on the device (total only). |
| Database changes | `supabase/migrations/`. Applied through the Supabase connector; the optional `Update database` workflow applies them too if its secrets are set. |

## How it's laid out (2.0)

Three places, named at the top: **Now** (what's yours to spend until payday, on a colour that shows how the month is going: lake blue when calm, cloudberry orange when tight, red when over), **Month** (the plan as one sentence: money in, bills, savings and living money, then each budget) and **Home** (the flat's floor plan and your lists). Your initial opens **You** (settings). A box at the bottom takes what you spent, like "Lidl 23,40", and shows what it understood before saving; on Home it adds to your list. New users answer three questions first: pay (including the last working day of the month), bills and bank balance.

## Files

| Path | What it is |
|---|---|
| `index.html` | App shell: Now, Month and Home at the top, the add box at the bottom, sheet layer |
| `css/app.css` | Design tokens, light and dark themes, phone and desktop layouts |
| `js/data.js` | Data model, migrations from earlier versions, local store and change queue |
| `js/sync.js` | Sign-in and sync with Supabase: offline queue, pulls by server timestamp, live updates |
| `js/now.js` | Now: yours to spend until payday, the mood colour, questions and what's next, "How we got there" |
| `js/month.js` | Month: the plan sentence, living money by category, money left to plan, match to bank |
| `js/place.js` | Home: the floor plan and your lists |
| `js/composer.js` | The add box: reads "Lidl 23,40" and confirms before saving; adds to a list on Home |
| `js/onboarding.js` | The three first-time questions |
| `js/install.js` | Getting Koti onto the Home Screen: one tap on Android and desktop, a guide on iPhone, open-in-browser help inside Instagram or WhatsApp, the strip on Now |
| `js/paydays.js` | Pay dates, including the last working day (weekdays, not Finnish public holidays) |
| `js/lists.js` | An opened list, sending a list, new list and list settings |
| `js/income.js` | Income sources, expected vs received, paydays |
| `js/setup.js` | Project view (Home setup with its floor plan, other projects), item and add sheets |
| `js/more.js` | You: account, month settings, import, backup, install help |
| `js/charts.js` | Floor plans and charts |
| `js/money.js` | Budgets screen, All spending screen, add/edit expense, categories, receipts list |
| `js/ledger.js` | Running balance month to month, what's left until payday |
| `js/plan.js` | Bills screen (calendar, paid tracking, autopay) and savings goals |
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
