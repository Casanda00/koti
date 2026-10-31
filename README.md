# Koti

A tracker for setting up a new home: the apartment's floor plan fills room by room as items are bought, with budget, spending charts and two-way sync to Google Sheets.

**Open it:** the GitHub Pages address for this repository (Settings → Pages).

## Files

| File | What it is |
|---|---|
| `index.html` | The dashboard. Built file, served by GitHub Pages. |
| `apps-script.gs` | Google Apps Script that connects the dashboard to a Google Sheet. |
| `src/koti.template.html` | Dashboard source. Edit this, not `index.html`. |
| `build.py` | Rebuilds `index.html` from the template and the Apps Script. |

## Connecting Google Sheets

1. In the Google Sheet: Extensions → Apps Script. Paste `apps-script.gs` and set `SECRET` (letters and numbers).
2. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone.
3. In the dashboard's Google Sheets panel, paste the `/exec` URL and the secret, then select Save to Sheets.

After changing the script, use Deploy → Manage deployments → edit → New version, so the URL stays the same.

The URL and secret are stored only in each browser. Nothing private is kept in this repository.
