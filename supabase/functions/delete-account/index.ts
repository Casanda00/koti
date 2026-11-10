// Koti: delete your account. Removes your saved receipt photos and bill documents, then the account;
// every table's rows go with it (they all cascade from auth.users). Only you can delete your own account.
// Called from You → Delete account (js/more.js). The App Store requires that an account made in the app can be
// deleted in the app. Deployed before 9 November 2026 and brought into the repository then, unchanged.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const URL_ = Deno.env.get("SUPABASE_URL") || "";
function serverKey(): string {   // new secret keys first, the legacy service role key otherwise
  try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); if (k.default) return k.default; } catch { /* legacy */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}
const SERVICE = serverKey();
const asServer = (): Record<string, string> => SERVICE.startsWith("eyJ") ? { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } : { apikey: SERVICE };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const BUCKET = "receipts";

async function removeFiles(uid: string) {
  let removed = 0;
  for (let round = 0; round < 50; round++) {
    const r = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, { method: "POST", headers: { ...asServer(), "Content-Type": "application/json" }, body: JSON.stringify({ prefix: `${uid}/`, limit: 100, offset: 0 }) });
    if (!r.ok) throw new Error(`Couldn't list your files (${r.status}).`);
    const files = (await r.json() as { name: string; id: string | null }[]).filter((f) => f.id);
    if (!files.length) break;
    const d = await fetch(`${URL_}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: { ...asServer(), "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: files.map((f) => `${uid}/${f.name}`) }) });
    if (!d.ok) throw new Error(`Couldn't delete your files (${d.status}).`);
    removed += files.length;
  }
  return removed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  const auth = req.headers.get("Authorization") || "";
  const who = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: auth, apikey: SERVICE } });
  if (!who.ok) return json(401, { error: "Sign in again, then try once more.", code: "auth" });
  const user = await who.json() as { id: string };
  const body = await req.json().catch(() => ({})) as { confirm?: string };
  if (body.confirm !== "DELETE") return json(400, { error: "Type DELETE to confirm." });
  try {
    const files = await removeFiles(user.id);
    const d = await fetch(`${URL_}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: asServer() });
    if (!d.ok) throw new Error(`Couldn't delete the account (${d.status}): ${(await d.text()).slice(0, 200)}`);
    return json(200, { deleted: true, files });
  } catch (e) {
    console.error(e);
    return json(500, { error: (e as Error).message });
  }
});
