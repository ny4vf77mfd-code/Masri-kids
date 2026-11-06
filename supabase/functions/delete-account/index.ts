// Masri Kids: account en alle gegevens van een gezin verwijderen (Supabase Edge Function 'delete-account').
// - Alleen de ingelogde ouder kan ZIJN EIGEN account verwijderen (het id komt uit de inlog, niet uit het verzoek).
// - Verwijdert eerst de eigen opnames en foto's (opslagmap <uid>/), daarna het account.
//   Spelers, voortgang, gezinsinstellingen en AI-gebruik verdwijnen automatisch mee
//   (ON DELETE CASCADE op auth.users). De gedeelde map shared/ wordt nooit aangeraakt.
// - Vereist { confirm: "VERWIJDER" } in het verzoek, als extra bescherming tegen per ongeluk.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ORIGINS = ["https://masri-kids.vercel.app", "http://localhost:8768"];

const cors = (req: Request) => {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) || /^https:\/\/masri-kids[\w-]*\.vercel\.app$/.test(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
};
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

// Alle bestanden onder een map, ook in submappen (audio/, pics/, ...)
async function listAll(admin: any, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from("media").list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const f of data || []) {
      const path = `${prefix}/${f.name}`;
      if (f.id === null) out.push(...await listAll(admin, path)); // map
      else out.push(path);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Alleen POST" }, 405);

  const userClient = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json(req, { error: "Niet ingelogd" }, 401);
  const uid = u.user.id;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* leeg */ }
  if (body.confirm !== "VERWIJDER") return json(req, { error: "Bevestiging ontbreekt" }, 400);

  const admin = createClient(SB_URL, SB_SERVICE);
  // Volgorde: eerst bestanden, dan het account. Mislukt een stap, dan stopt de functie en blijft
  // het account bestaan, zodat de ouder het later opnieuw kan proberen (opnieuw draaien is veilig).
  let stap = "bestanden";
  try {
    // 1. eigen opnames en foto's
    const files = await listAll(admin, uid);
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await admin.storage.from("media").remove(files.slice(i, i + 100));
      if (error) throw error;
    }
    // 2. account (spelers, voortgang, instellingen en AI-gebruik gaan automatisch mee)
    stap = "account";
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) throw error;
    return json(req, { ok: true, files: files.length });
  } catch (e) {
    // Geen e-mailadres, id of bestandsnamen in het logboek of in het antwoord.
    const code = (e as { status?: number; name?: string })?.status ?? (e as { name?: string })?.name ?? "onbekend";
    console.error(`delete-account mislukt bij stap '${stap}' (code ${code})`);
    return json(req, { error: "Verwijderen is niet gelukt. Probeer het later opnieuw of mail ons." }, 500);
  }
});
