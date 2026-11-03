// Masri AI-taalpartner (Supabase Edge Function 'ai-chat')
// Veiligheid en kosten:
// - De API-sleutel staat alleen hier als Supabase Secret. De app ziet hem nooit.
// - De AI staat UIT tot de beheerder hem per doelgroep activeert (tabel ai_config).
//   Tot die tijd kan alleen de beheerder proefgesprekken voeren.
// - Personage, niveau en veiligheidsregels bepaalt de server op basis van het profiel in de database.
// - Kinderen: alleen als een ouder dit per kind heeft aangezet, met daglimiet per kind,
//   persoonlijke gegevens worden niet naar de AI gestuurd.
// - Limieten: berichten per gezin per dag en een maandbudget in tokens voor de hele app.
// Uitbreiden: spraak (STT/TTS) kan als extra actie naast 'chat'. Andere AI-provider: zie providers.ts.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getProvider, type Msg } from "./providers.ts";
import { systemPrompt, SCHEMA, SCENES, KID_TOPICS, TESTS } from "./prompts.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ORIGINS = ["https://masri-kids.vercel.app", "http://localhost:8768"];
const KID_DAILY_DEFAULT = 20;

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

// persoonlijke gegevens van kinderen gaan niet naar de AI
const PERSONAL = [
  /[\w.+-]+@[\w-]+\.[\w.]+/, /(\+?\d[\d\s-]{7,}\d)/, /https?:\/\/|www\./i,
  /\b(adres|straat|woon ?plaats|postcode|wachtwoord|password|telefoon|mobiel|whatsapp|instagram|snapchat|tiktok)\b/i,
];
const KID_PRIVACY_REPLY = {
  reply: { ar: "يلا نتعلم كلمة جديدة!", ph: "Yalla Net3allem Kelma Gedeeda!", nl: "Kom, we leren een nieuw woord!" },
  correction: null, new_words: [], suggestions: [{ ar: "ماشي", ph: "Mashi", nl: "Oké" }, { ar: "أيوه", ph: "Aywa", nl: "Ja" }],
  explanation_nl: "Dat hoef je mij niet te vertellen. Persoonlijke dingen zoals je adres, school of telefoonnummer houd je voor jezelf.",
  needs_adult: false, filtered: true,
};

// eenvoudige automatische dialectcheck (jouw eigen oordeel telt het zwaarst)
const MSA = ["ماذا", "لماذا", "سوف", "ليس ", "هذا", "هذه", "أريد", "الآن", "كيف ", "لا أعرف", "جداً", "جدا", "أين", "يجب", "لكن", "حسناً", "شكراً جزيلاً", "هل "];
const EGY = ["إيه", "ايه", "ليه", "مش", "ده", "دي", "دلوقتي", "عايز", "عايزة", "إزاي", "ازاي", "أوي", "اوي", "فين", "كده", "معلش", "بتاع", "يلا", "حلو", "بس", "خلاص", "ماشي", "إزيك", "ازيك", "كويس", "مين", "إمتى", "عامل", "عاملة", "بقى", "خالص"];
const dialect = (t: Record<string, any>) => {
  const ar = [t?.reply?.ar, ...(t?.suggestions || []).map((s: { ar: string }) => s.ar)].join(" ");
  return { msa: MSA.filter(w => ar.includes(w.trim())), egy: EGY.filter(w => ar.includes(w)) };
};

const monthStart = () => new Date().toISOString().slice(0, 8) + "01";
async function monthTokens(admin: any) {
  const { data } = await admin.from("ai_usage").select("tokens_in,tokens_out").gte("day", monthStart());
  return (data || []).reduce((a: number, r: any) => a + Number(r.tokens_in || 0) + Number(r.tokens_out || 0), 0);
}
async function addUsage(admin: any, fam: string, pid: string | null, msgs: number, tin: number, tout: number) {
  const day = new Date().toISOString().slice(0, 10);
  const { data: u } = await admin.from("ai_usage").select("*").eq("family_id", fam).eq("day", day).maybeSingle();
  const pp = { ...(u?.per_player || {}) };
  if (pid) pp[pid] = (pp[pid] || 0) + msgs;
  await admin.from("ai_usage").upsert({ family_id: fam, day, count: (u?.count || 0) + msgs, tokens_in: Number(u?.tokens_in || 0) + tin, tokens_out: Number(u?.tokens_out || 0) + tout, per_player: pp });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Alleen POST" }, 405);
  const userClient = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json(req, { error: "Niet ingelogd" }, 401);
  const fam = u.user.id;
  const admin = createClient(SB_URL, SB_SERVICE);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return json(req, { error: "Ongeldig verzoek" }, 400); }
  const action = String(body.action || "chat");
  const provider = getProvider();
  const { data: cfg } = await admin.from("ai_config").select("*").eq("id", 1).maybeSingle();
  const { data: adm } = await admin.from("admins").select("user_id").eq("user_id", fam).maybeSingle();
  const isAdmin = !!adm;
  const day = new Date().toISOString().slice(0, 10);

  if (action === "status") {
    const { data: today } = await admin.from("ai_usage").select("count,per_player").eq("family_id", fam).eq("day", day).maybeSingle();
    const out: Record<string, unknown> = {
      configured: provider.configured(), provider: provider.name,
      active_adult: !!cfg?.active_adult, active_kids: !!cfg?.active_kids, admin: isAdmin,
      today: { msgs: today?.count || 0, per_player: today?.per_player || {} }, family_daily_msgs: cfg?.family_daily_msgs,
    };
    if (isAdmin) {
      const { data: rows } = await admin.from("ai_usage").select("day,count,tokens_in,tokens_out").gte("day", monthStart());
      out.month = (rows || []).reduce((a: any, r: any) => ({ msgs: a.msgs + (r.count || 0), tokens_in: a.tokens_in + Number(r.tokens_in || 0), tokens_out: a.tokens_out + Number(r.tokens_out || 0) }), { msgs: 0, tokens_in: 0, tokens_out: 0 });
      out.config = cfg;
    }
    return json(req, out);
  }
  if (!provider.configured()) return json(req, { error: "not_configured" }, 503);
  if (!cfg) return json(req, { error: "Instellingen ontbreken" }, 500);

  // kostenbewaking: maandbudget voor de hele app
  const used = await monthTokens(admin);
  if (used >= Number(cfg.monthly_token_limit)) return json(req, { error: "Het maandbudget van de taalpartner is op. Volgende maand kan het weer." }, 429);

  if (action === "dialect-test") {
    if (!isAdmin) return json(req, { error: "Alleen voor beheerders" }, 403);
    const models: string[] = (cfg.test_models || []).slice(0, 3);
    let tin = 0, tout = 0;
    // max 6 tegelijk, zodat we de limieten van de provider niet raken
    const queue = models.flatMap(m => TESTS.map((t, ti) => ({ m, t, ti })));
    const out: any[] = new Array(queue.length);
    let next = 0;
    const run1 = async ({ m, t, ti }: { m: string; t: typeof TESTS[number]; ti: number }) => {
      const t0 = Date.now();
      try {
        const sys = systemPrompt(t.kind, t.level, t.kind === "kids" ? KID_TOPICS[t.scene] : t.scene, t.female);
        const r = await provider.turn({ model: m, system: sys, maxTokens: 900, schema: SCHEMA,
          messages: [{ role: "user", content: JSON.stringify({ learner_message: t.msg, known_words: [], explain_nl: /nederlands/i.test(t.msg) }) }] });
        tin += r.tokensIn; tout += r.tokensOut;
        return { model: m, ti, ...t, ms: Date.now() - t0, turn: r.turn, ...dialect(r.turn) };
      } catch (e) { return { model: m, ti, ...t, ms: Date.now() - t0, error: String(e).slice(0, 300) }; }
    };
    await Promise.all(Array.from({ length: 6 }, async () => { while (next < queue.length) { const k = next++; out[k] = await run1(queue[k]); } }));
    const results = out.map((r, idx) => ({ ...r, idx }));
    await addUsage(admin, fam, null, 0, tin, tout);
    const summary = models.map(m => { const r = results.filter((x: any) => x.model === m && !x.error) as any[];
      return { model: m, ok: r.length, total: TESTS.length, msaHits: r.reduce((a, x) => a + x.msa.length, 0), egyHits: r.reduce((a, x) => a + x.egy.length, 0),
        avgMs: Math.round(r.reduce((a, x) => a + x.ms, 0) / Math.max(1, r.length)) }; });
    const { data: row } = await admin.from("ai_tests").insert({ created_by: fam, summary, results }).select("id").single();
    return json(req, { id: row?.id, summary, results, tokens: { in: tin, out: tout } });
  }

  if (action !== "chat") return json(req, { error: "Onbekende actie" }, 400);

  // profiel: persoonage, niveau en toestemming komen uit de database
  const pid = String(body.player_id || "");
  const { data: prow } = await admin.from("players").select("data").eq("id", pid).eq("family_id", fam).maybeSingle();
  if (!prow) return json(req, { error: "Profiel niet gevonden" }, 404);
  const p = prow.data as Record<string, any>;
  const kind: "kids" | "adult" = p.track === "adult" ? "adult" : "kids";
  const active = kind === "kids" ? cfg.active_kids : cfg.active_adult;
  if (!active && !isAdmin) return json(req, { error: "De taalpartner is nog niet geactiveerd." }, 403);
  if (kind === "kids") {
    if (p.kind === "k1" || p.level === 1) return json(req, { error: "Voor kinderen van 4 tot 6 is de taalpartner nog niet beschikbaar." }, 403);
    if (p.aiAllowed !== true) return json(req, { error: "Een ouder moet de taalpartner eerst aanzetten voor dit profiel (Ouders → Instellingen)." }, 403);
  }

  const msg = String(body.message || "").slice(0, 400).trim();
  if (!msg && !body.start) return json(req, { error: "Leeg bericht" }, 400);

  // daglimieten
  const { data: today } = await admin.from("ai_usage").select("count,per_player").eq("family_id", fam).eq("day", day).maybeSingle();
  if ((today?.count || 0) >= Number(cfg.family_daily_msgs)) return json(req, { error: "Het maximum aantal berichten voor vandaag is bereikt. Morgen kun je weer verder." }, 429);
  const kidLimit = Number(p.aiDaily || KID_DAILY_DEFAULT);
  if (kind === "kids" && ((today?.per_player || {})[pid] || 0) >= kidLimit) return json(req, { error: "Je hebt vandaag genoeg gekletst met Mishmish. Morgen weer!" }, 429);

  if (kind === "kids" && msg && PERSONAL.some(r => r.test(msg))) { await addUsage(admin, fam, pid, 1, 0, 0); return json(req, { turn: KID_PRIVACY_REPLY, kind, preview: !active }); }

  const level = kind === "adult" ? Number(p.alevel || 1) : 1;
  const female = p.gender === "f";
  const sceneKey = String(body.scene || (kind === "kids" ? "animals" : "free"));
  const scene = kind === "kids" ? (KID_TOPICS[sceneKey] || KID_TOPICS.animals) : (SCENES[sceneKey] ? sceneKey : "free");

  // gespreksgeheugen binnen de sessie (de app stuurt max 16 eerdere beurten mee)
  const hist = Array.isArray(body.history) ? body.history.slice(-16) : [];
  const known = Array.isArray(body.known_words) ? body.known_words.slice(0, 60) : [];
  const clean: Msg[] = [];
  if (hist.length && hist[0]?.role === "assistant") clean.push({ role: "user", content: "(start the conversation)" });
  hist.forEach((h: any) => { if (!h || !h.text || (h.role !== "user" && h.role !== "assistant")) return;
    const c = String(h.text).slice(0, 600);
    if (clean.length && clean[clean.length - 1].role === h.role) clean[clean.length - 1].content += "\n" + c; else clean.push({ role: h.role, content: c }); });
  if (clean.length && clean[clean.length - 1].role === "user") clean.push({ role: "assistant", content: "(ok)" });
  clean.push({ role: "user", content: JSON.stringify({ learner_message: msg || "(start the conversation: greet the learner and open the situation)", known_words: known.map((k: any) => `${k.ph} = ${k.nl}`), explain_nl: !!body.explain_nl }) });

  try {
    const model = kind === "kids" ? cfg.model_kids : cfg.model_adult;
    const r = await provider.turn({ model, system: systemPrompt(kind, level, scene, female), messages: clean, schema: SCHEMA, maxTokens: kind === "kids" ? 600 : 900 });
    await addUsage(admin, fam, pid, 1, r.tokensIn, r.tokensOut);
    const turn = r.turn;
    if (kind === "kids" && turn?.reply?.ar && String(turn.reply.ar).length > 120) turn.reply.ar = String(turn.reply.ar).slice(0, 120);
    return json(req, { turn, kind, level, preview: !active });
  } catch (e) {
    return json(req, { error: "De taalpartner reageert even niet. Probeer het zo nog eens.", detail: String(e).slice(0, 200) }, 502);
  }
});
