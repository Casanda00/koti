// Leaving an account on this phone: by Sign out in You, or when the session ends some other way (it expired or was
// revoked, signed out on another device, the password changed). Either way nothing of the account stays on the phone.

/* What stays on the phone after signing out: this device's own choices, nothing of the account. */
export const KEEP_ON_SIGN_OUT = ["koti.consent", "koti.install", "koti.palette", "koti.mode", "koti.heroView", "koti.aiLimit", "koti.reloadedFor", "kotiSpeaks"];
export async function clearAccountHere(storage = localStorage, keep = []) {
  try { Object.keys(storage).filter(k => k.startsWith("koti") && !KEEP_ON_SIGN_OUT.includes(k) && !keep.includes(k)).forEach(k => storage.removeItem(k)); } catch {}
  try { indexedDB.deleteDatabase("koti-files"); } catch {}   // receipt photos
}

/* The session ended without Sign out, on a phone holding that account's data (meta.owner). What hasn't reached the
   account yet is kept aside under that account (not shown, and back when it signs in here again, or gone with a
   Sign out); the rest is cleared. Returns what was done, for the message. */
export async function sessionEnded(store, pending, storage = localStorage) {
  const owner = store.meta.owner; if (!owner) return null;
  const keep = pending ? ["koti.account." + owner] : [];
  if (pending) store.stashAccount(owner);
  await clearAccountHere(storage, keep);
  return { owner, kept: !!pending };
}
