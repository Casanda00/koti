/**
 * Koti — Google Sheets backend for your new home tracker
 *
 * Setup:
 *  1. Open your Google Sheet → Extensions → Apps Script.
 *  2. Replace everything in Code.gs with this file and change SECRET below.
 *  3. Deploy → New deployment → type "Web app".
 *     Execute as: Me · Who has access: Anyone. Copy the /exec URL.
 *  4. Paste the URL and the same secret into the dashboard's Google Sheets panel.
 *
 * The sheet gets three tabs:
 *  Items     one row per item. Edit freely: tick Purchased, type a price, add rows.
 *            A new name in the List column creates a new list.
 *  Settings  budget, other spending, moved-in date, notes, which room each list belongs to.
 *  Summary   live formulas per list (items, bought, spent) for your own Sheets charts.
 */
const SECRET = 'change-me-to-a-long-random-phrase';

const ITEMS = 'Items', SETTINGS = 'Settings', SUMMARY = 'Summary';
const HEAD = ['List', 'Item', 'Priority', 'Purchased', 'Price (€)', 'Purchased on', 'ID'];

function doGet(e) {
  return respond_(() => {
    auth_(e.parameter.token);
    if (e.parameter.action !== 'get') throw new Error('Unknown action.');
    return { state: readState_() };
  });
}

function doPost(e) {
  return respond_(() => {
    const body = JSON.parse(e.postData.contents || '{}');
    auth_(body.token);
    if (body.action !== 'save') throw new Error('Unknown action.');
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { writeState_(body.state); } finally { lock.releaseLock(); }
    return { savedAt: new Date().toISOString() };
  });
}

/** Bumps the timestamp when you edit the sheet by hand, so the dashboard picks it up. */
function onEdit(e) {
  const name = e.range.getSheet().getName();
  if (name === ITEMS || name === SETTINGS) setSetting_('updatedAt', new Date().toISOString());
}

function respond_(fn) {
  let out;
  try { out = Object.assign({ ok: true }, fn()); }
  catch (err) { out = { ok: false, error: String(err.message || err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function auth_(token) {
  if (!token || token !== SECRET) throw new Error('Wrong shared secret. Use the same secret as in Apps Script.');
}

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function writeState_(state) {
  if (!state || !Array.isArray(state.categories)) throw new Error('No checklist data received.');
  const rows = [];
  state.categories.forEach(c => (c.items || []).forEach(i => {
    let d = '';
    if (i.boughtAt) { const p = String(i.boughtAt).slice(0, 10).split('-'); d = new Date(+p[0], +p[1] - 1, +p[2]); }
    rows.push([c.name, i.name, i.priority || 'Soon', !!i.done,
      i.price === null || i.price === undefined || i.price === '' ? '' : Number(i.price), d, i.id]);
  }));

  const sh = sheet_(ITEMS);
  sh.clear();
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold').setBackground('#e6f1ea');
  sh.setFrozenRows(1);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, HEAD.length).setValues(rows);
  }
  const n = Math.max(rows.length, 1) + 200; // room to add rows by hand
  sh.getRange(2, 4, n, 1).insertCheckboxes();
  sh.getRange(2, 3, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['Essential', 'Soon', 'Later'], true).setAllowInvalid(false).build());
  sh.getRange(2, 5, n, 1).setNumberFormat('€#,##0.00');
  sh.getRange(2, 6, n, 1).setNumberFormat('yyyy-mm-dd');
  sh.autoResizeColumns(1, HEAD.length);

  setSetting_('budget', Number(state.budget) || 0);
  setSetting_('extraSpend', Number(state.extraSpend) || 0);
  setSetting_('notes', state.notes || '');
  setSetting_('movedIn', state.movedIn || '');
  setSetting_('roomMap', JSON.stringify(state.roomMap || {}));
  setSetting_('updatedAt', state.updatedAt || new Date().toISOString());
  buildSummary_(state.categories.map(c => c.name));
}

function readState_() {
  const tz = Session.getScriptTimeZone();
  const sh = sheet_(ITEMS);
  const values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.length).getValues() : [];
  const cats = [], byName = {};
  values.forEach((r, n) => {
    const list = String(r[0]).trim(), name = String(r[1]).trim();
    if (!list || !name) return;
    if (!byName[list]) { byName[list] = { name: list, items: [] }; cats.push(byName[list]); }
    const pr = ['Essential', 'Soon', 'Later'].indexOf(r[2]) >= 0 ? r[2] : 'Soon';
    const date = r[5] instanceof Date ? Utilities.formatDate(r[5], tz, 'yyyy-MM-dd') : (r[5] ? String(r[5]).slice(0, 10) : null);
    byName[list].items.push({
      id: r[6] ? String(r[6]) : 'sheet-' + (n + 2) + '-' + name.toLowerCase().replace(/\W+/g, '-'),
      name: name, priority: pr, done: r[3] === true,
      price: r[4] === '' || r[4] === null ? null : Number(r[4]),
      boughtAt: date
    });
  });
  if (!cats.length) throw new Error('The Items tab is empty. Save from the dashboard first.');
  const s = settings_();
  let roomMap = {};
  try { roomMap = JSON.parse(s.roomMap || '{}'); } catch (err) { roomMap = {}; }
  const moved = s.movedIn instanceof Date ? Utilities.formatDate(s.movedIn, tz, 'yyyy-MM-dd') : String(s.movedIn || '');
  return {
    version: 2, categories: cats, roomMap: roomMap, movedIn: moved,
    budget: Number(s.budget) || 0, extraSpend: Number(s.extraSpend) || 0,
    notes: s.notes || '', updatedAt: s.updatedAt ? String(s.updatedAt) : new Date(0).toISOString()
  };
}

function settings_() {
  const sh = sheet_(SETTINGS), out = {};
  if (sh.getLastRow() > 0) sh.getRange(1, 1, sh.getLastRow(), 2).getValues().forEach(r => { if (r[0]) out[r[0]] = r[1]; });
  return out;
}

function setSetting_(key, value) {
  const sh = sheet_(SETTINGS);
  const last = sh.getLastRow();
  const keys = last ? sh.getRange(1, 1, last, 1).getValues().map(r => r[0]) : [];
  const i = keys.indexOf(key);
  sh.getRange(i >= 0 ? i + 1 : last + 1, 1, 1, 2).setValues([[key, value]]);
}

function buildSummary_(lists) {
  const sh = sheet_(SUMMARY);
  sh.clear();
  sh.getRange(1, 1, 1, 5).setValues([['List', 'Items', 'Bought', '% bought', 'Spent (€)']])
    .setFontWeight('bold').setBackground('#e6f1ea');
  lists.forEach((list, k) => {
    const r = k + 2;
    sh.getRange(r, 1, 1, 5).setFormulas([[
      '="' + list.replace(/"/g, '""') + '"',
      '=COUNTIF(Items!A:A,A' + r + ')',
      '=COUNTIFS(Items!A:A,A' + r + ',Items!D:D,TRUE)',
      '=IF(B' + r + '=0,0,C' + r + '/B' + r + ')',
      '=SUMIFS(Items!E:E,Items!A:A,A' + r + ',Items!D:D,TRUE)'
    ]]);
  });
  const t = lists.length + 2;
  sh.getRange(t, 1, 1, 5).setFormulas([[
    '="Total"', '=SUM(B2:B' + (t - 1) + ')', '=SUM(C2:C' + (t - 1) + ')',
    '=IF(B' + t + '=0,0,C' + t + '/B' + t + ')', '=SUM(E2:E' + (t - 1) + ')'
  ]]).setFontWeight('bold');
  sh.getRange(2, 4, t, 1).setNumberFormat('0%');
  sh.getRange(2, 5, t, 1).setNumberFormat('€#,##0.00');
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 5);
}
