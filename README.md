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
| The microphone | Edge Function `hear` (`supabase/functions/hear`): a recording from the add box is written down by OpenAI (`OPENAI_TRANSCRIBE_MODEL`, default `gpt-4o-mini-transcribe`, Finnish or English), then read for what was meant: a purchase with its lines, a question about spending, a reminder or things for a list. Typed phrases the on-device rules can't read go the same way. Counts in the same daily AI limit as receipts. Offline or signed out, the phone's own speech recognition is used. |
| Database changes | `supabase/migrations/`. Applied through the Supabase connector; the optional `Update database` workflow applies them too if its secrets are set. |

## How it's laid out (2.1)

Two tabs at the top, and a swipe between them: **Today** (what's left to spend today: what was left until payday this morning, shared over the days to payday, minus what you've spent today; the colour shows how today is going) and the month, named after it (**November**: income, bills, savings and living expenses, then each budget). **Projects** (your home with its floor plan, other projects and your lists) opens from the month. Your initial opens **You** (settings). **Today's payments** lists the payments you made, for any period you pick from its title, custom dates included; it also arrives as a notification each evening at 20:00. A box at the bottom takes what you spent, like "Lidl 23,40", and shows what it understood before saving; in Projects it adds to your list.

## Rules worth knowing

- **Sync:** the database keeps the newer copy of every row, so an older upload can't overwrite a newer edit or undo a delete. Settings merge setting by setting.
- **Left until payday:** what's left after everything owed before the next payday is set aside. That covers unpaid bills due by then, overdue bills however old, payments dated later, and this month's savings plan not yet moved. Moving money to a goal is a transfer, not spending.
- **Direct debits:** they're never recorded as paid by themselves. Koti asks from the due date whether each one went out.
- **Paydays:** one that falls on a weekend or a Finnish public holiday moves to the working day before.
- **Money figures:** every one is worked out in `js/engine.js`, in whole cents. The reminders server runs a copy, `supabase/functions/send-reminders/engine.js`; after changing the engine, copy it there too (a test fails until the two are the same).
- **Reminders:** they follow each person's phone time zone, which the app saves in settings. They're worked out from the person's own records, not from figures the phone saved.
- **Budgets:** Koti doesn't make them up. "Suggest budgets" asks a few questions, and the AI divides what the engine says is left after bills and savings; the server keeps the total within it.
- **Tests:** `npm test` (Node 22) runs the app's own modules against a pretend server that applies the database's rules. CI runs it on every pull request.

## Files

| Path | What it is |
|---|---|
| `index.html` | App shell: Now, Month and Home at the top, the add box at the bottom, sheet layer |
| `css/app.css` | Design tokens, light and dark themes, phone and desktop layouts |
| `js/data.js` | Data model, migrations from earlier versions, local store and change queue |
| `js/sync.js` | Sign-in and sync with Supabase: offline queue, pulls by (server time, id), live updates, settings merged one by one, refused changes set aside and shown in You, each account's data kept apart on a device |
| `js/now.js` | Today: left to spend today, the mood colour, questions, what you spent today and what's due |
| `js/month.js` | The month: income, bills, savings, living expenses, budgets, money left to plan, match to bank |
| `js/place.js` | Projects: your home with its floor plan, other projects, your lists |
| `js/composer.js` | The add box: reads "Lidl 23,40" and confirms before saving; answers "what did I spend last week?"; adds to a list on Home |
| `js/onboarding.js` | The three first-time questions |
| `js/spent.js` | Spent: today, yesterday, this week, last week, this month and last month, compared with what's usual, by category, a bar a day, the purchases; the Today / Yesterday / This week row on Now |
| `js/hear.js` | The microphone with AI: records, sends to `hear`, turns the answer into a purchase, a question, a reminder or list items |
| `js/period.js` | The period picker: a title with a down arrow, Today to last month, and custom dates |
| `js/receipt.js` | Today's payments: every payment in a period, as a receipt; and today's share |
| `tests/` | `npm test`: sync, money, bills, paydays and accounts, each against the defect it guards |
| `js/install.js` | Getting Koti onto the Home Screen: one tap on Android and desktop, a guide on iPhone, open-in-browser help inside Instagram or WhatsApp, the strip on Now |
| `js/paydays.js` | Pay dates, including the last working day (weekdays, not Finnish public holidays) |
| `js/lists.js` | An opened list, sending a list, new list and list settings |
| `js/income.js` | Income sources, expected vs received, paydays |
| `js/setup.js` | Project view (Home setup with its floor plan, other projects), item and add sheets |
| `js/more.js` | You: account, month settings, import, backup, install help |
| `js/charts.js` | Floor plans and charts |
| `js/money.js` | Budgets screen, add/edit expense, categories, receipts list |
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
