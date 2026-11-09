# Koti

A phone-first app for setting up a new home and, in later steps, planning money. It installs to the home screen from the browser, works offline, and syncs between devices through Supabase.

**Open it:** https://casanda00.github.io/koti/

## How it fits together

| Part | Where |
|---|---|
| App (screens, logic) | This repository, served by GitHub Pages. Plain HTML, CSS and JavaScript modules; no build step. |
| Data | Supabase project `koti` (`dghcrcneikxuaacsyhpy`): tables `lists` (shopping lists, projects and their room lists), `items`, `settings`, `categories`, `transactions`, `bills`, `goals`, `income_sources`, each locked to the signed-in user with row level security. |
| Receipts | Private Storage bucket `receipts`; each user can only reach `{user id}/…`. Read on the device with Tesseract (English + Finnish), bundled in `js/vendor/tesseract-7.0.0/` and loaded only when scanning. |
| Receipt reading | Edge Function `read-receipt` (`supabase/functions/read-receipt`): checks the signed-in user, counts the daily limit, sends the photo to OpenAI and returns shop, date, total and every line. Screenshots of payments are read too (`payments.js`): one payment from a bank, card or payment app or an order confirmation (money out or in, and a payment of one of your bills offers to mark it paid), or a bank app's list of several, each to tick, with ones already in Koti unticked. A screenshot can come from the scan button, the camera in a conversation with Koti, or the phone's share menu (Android and desktop Chrome; iPhone doesn't let web apps receive shares). Needs the secret `OPENAI_API_KEY`; optional `OPENAI_MODEL` and `AI_DAILY_LIMIT`. Without it, receipts are read on the device (total only). |
| The microphone | Edge Function `hear` (`supabase/functions/hear`): a recording from the add box is written down by OpenAI (`OPENAI_TRANSCRIBE_MODEL`, default `gpt-4o-mini-transcribe`, Finnish or English), then read for what was meant: a purchase with its lines, a question about spending, a reminder or things for a list; any other question or request goes on to Koti's brain. The shops the person uses most and what Koti remembers help it hear and read them. Typed phrases the on-device rules can't read go the same way. Counts in the same daily AI limit as receipts. Offline or signed out, the phone's own speech recognition is used. |
| Koti's brain | Edge Function `koti` (`supabase/functions/koti`): talk to Koti, typed or held to talk, and today's "Koti noticed" note. It reads the signed-in person's own records with their own sign-in (row level security), works out where they stand with the app's engine, and lets the model look things up (spending by period, category, shop or thing bought; bills; lists; reminders; "can I afford it") and propose actions (an expense, list items, a reminder, a bill, a goal, a budget, something to remember). Actions come back as cards to tap; nothing is saved on the server. Counts in the daily AI limit. |
| The AI model | `supabase/functions/_shared/openai.js`, used by every function: `gpt-5-mini` by default (low cost, reasons, calls tools, reads receipts better than the old `gpt-4o-mini`). `OPENAI_MODEL` overrides it everywhere; `OPENAI_REASONING` sets how hard it thinks (minimal, low, medium, high). |
| Database changes | `supabase/migrations/`. Applied through the Supabase connector; the optional `Update database` workflow applies them too if its secrets are set. |

## How it's laid out (2.1)

Two tabs at the top, and a swipe between them: **Today** (what's left to spend today: what was left until payday this morning, shared over the days to payday, minus what you've spent today; the colour shows how today is going) and the month, named after it (**November**: income, bills, savings and living expenses, then each budget). **Projects** (your home with its floor plan, other projects and your lists) opens from the month. Your initial opens **You** (settings); the spark beside it opens **Koti**, a conversation about your money and home that can look things up and propose what to add. **Koti noticed** at the top of Today is a short note Koti writes once a day: a bill coming, spending against a usual week, a goal nearly there. **Today's payments** lists the payments you made, for any period you pick from its title, custom dates included; it also arrives as a notification each evening at 20:00. A box at the bottom takes what you spent, like "Lidl 23,40", and shows what it understood before saving; in Projects it adds to your list.

## Rules worth knowing

- **Sync:** the database keeps the newer copy of every row, so an older upload can't overwrite a newer edit or undo a delete. Settings merge setting by setting.
- **Left until payday:** what's left after everything owed before the next payday is set aside. That covers unpaid bills due by then, overdue bills however old, payments dated later, and this month's savings plan not yet moved. Moving money to a goal is a transfer, not spending.
- **Direct debits:** they're never recorded as paid by themselves. Koti asks from the due date whether each one went out.
- **Paydays:** one that falls on a weekend or a Finnish public holiday moves to the working day before.
- **Money figures:** every one is worked out in `js/engine.js`, in whole cents. The reminders server runs a copy, `supabase/functions/send-reminders/engine.js`; after changing the engine, copy it there too (a test fails until the two are the same).
- **Reminders:** they follow each person's phone time zone, which the app saves in settings. They're worked out from the person's own records, not from figures the phone saved.
- **Budgets and savings:** Koti doesn't make them up. "Plan my month" asks everything that decides the plan, one question to a screen with Next and Back and a box on each for your own words: this month's pay and bills, whether to learn from past spending (offered only when there is some), saving, who lives with you, food, getting around and anything big coming. Household, food and transport are offered first next time. Then the AI shares what's left after bills between savings goals and budgets; the server keeps the total within it, shrinking budgets before savings.
- **Privacy (EU):** Koti sets no cookies and has no ads, analytics or tracking. What it keeps on the device (sign-in, records, settings, receipts waiting to upload, the offline app, the choice below) is needed for it to work and is listed in You → Privacy. Koti's AI is a choice made once per device (`js/privacy.js`): until it's allowed, nothing goes to OpenAI and the phone reads and hears for itself; "Only necessary" and "Allow AI" look alike, and it can be changed any time. The font is served from Koti (`fonts/`, SIL OFL), not Google Fonts.
- **Conversations with Koti:** kept on the device for 30 days in Earlier chats (up to 30), then deleted; not synced. A new one starts after six hours away. What Koti remembers about you is what carries between conversations and devices.
- **Koti's AI never makes up a figure:** every amount it says comes from the engine's snapshot or a look-up over the person's records, and what it proposes is checked against those records (their own categories, real dates, amounts above zero) before it becomes a card. Purchases and bills open the usual sheet to check; small things (a list, a reminder, a goal, a budget) happen on a tap, with Undo.
- **What Koti remembers:** short facts about the person (`settings.memory`, at most 40), added when they tell Koti about themselves and listed in You, where any can be removed. They go with every question to Koti and the microphone. Card numbers and passwords are refused.
- **Words:** a hint, note or subtitle is one short sentence, 14 words at most (the owner's rule, 9 November 2026). `tests/words.test.mjs` reads every one in the app's screens and fails on a longer one. Koti's AI follows it too: one or two short sentences in a conversation, one about a scan.
- **Dates:** a receipt, bill or payment is saved on the day it happened, never on the day it was scanned by default. The reader returns the date as printed, and `js/printeddate.js` (copied to the server) works it out when the AI's date is missing, impossible or ahead: a date with no year or only a weekday is the most recent such day. If the day still isn't known, Koti asks "When was this?" and won't save until you pick.
- **Tests:** `npm test` (Node 22) runs the app's own modules against a pretend server that applies the database's rules. CI runs it on every pull request.

## Files

| Path | What it is |
|---|---|
| `index.html` | App shell: Now, Month and Home at the top, the add box at the bottom, sheet layer |
| `css/fonts.css`, `fonts/` | Archivo, served from Koti (SIL Open Font License, `fonts/OFL.txt`) |
| `css/app.css` | Design tokens, light and dark themes, phone and desktop layouts |
| `js/data.js` | Data model, migrations from earlier versions, local store and change queue |
| `js/sync.js` | Sign-in and sync with Supabase: offline queue, pulls by (server time, id), live updates, settings merged one by one, refused changes set aside and shown in You, each account's data kept apart on a device |
| `js/now.js` | Today: left to spend today, the mood colour, questions, what you spent today and what's due |
| `js/month.js` | The month: income, bills, savings, living expenses, budgets, money left to plan, match to bank |
| `js/place.js` | Projects: your home with its floor plan, other projects, your lists |
| `js/composer.js` | The add box: reads "Lidl 23,40" and confirms before saving; answers "what did I spend last week?"; adds to a list on Home |
| `js/onboarding.js` | The three first-time questions |
| `js/spent.js` | Spent: today, yesterday, this week, last week, this month and last month, compared with what's usual, by category, a bar a day, the purchases; the Today / Yesterday / This week row on Now |
| `js/brain.js` | Koti's brain on the phone: sends a turn to `koti`, applies what Koti remembers, carries out the actions you tap, fetches today's note once a day |
| `js/privacy.js` | The privacy banner (first open on a device), You → Privacy, and whether Koti's AI may be used |
| `js/koti.js` | The conversation sheet (type or hold to talk, follow-up questions, action cards, answers read out loud after a spoken question), "Koti noticed" on Today, and What Koti remembers |
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
