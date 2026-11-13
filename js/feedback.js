// "How did Koti do?" (the owner, 13 November 2026: "Koti can ask for review at the end of conversations to improve").
// At the end of a chat Koti asks once: Good, or Could be better with a few words. It's kept with your settings
// (settings.kotiFeedback, synced, private to you, the last 30), and what you said could be better goes into Koti's
// instructions for your next chats (supabase/functions/koti/agent.js, feedbackOf), so it does better at it.
// Asked at most once a day, and only after a real conversation (two things said or more).
import { store, newId, todayISO } from "./data.js";

export const FEEDBACK_MAX = 30;
const ASKED = "koti.rateAsked";
export const feedback = () => (Array.isArray(store.model.settings.kotiFeedback) ? store.model.settings.kotiFeedback : []).filter(f => f && typeof f.good === "boolean");

/* Whether to ask at the end of this chat. */
export function shouldAsk(messages) {
  let asked = null; try { asked = localStorage.getItem(ASKED); } catch {}
  return asked !== todayISO() && (messages || []).filter(m => m.role === "user").length >= 2;
}
export const markAsked = () => { try { localStorage.setItem(ASKED, todayISO()); } catch {} };

/* One rating. good: true or false; note: what could be better, a few words. */
export function rateChat({ good, note = "", title = "" }) {
  const item = { id: newId("fb"), good: !!good, note: String(note || "").trim().slice(0, 200) || null, title: String(title || "").slice(0, 80) || null, at: todayISO() };
  store.updateSettings({ kotiFeedback: [...feedback(), item].slice(-FEEDBACK_MAX) });
  markAsked();
  return item;
}
export const forgetFeedback = id => store.updateSettings({ kotiFeedback: feedback().filter(f => f.id !== id) });
