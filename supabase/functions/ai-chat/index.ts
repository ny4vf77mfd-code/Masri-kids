// Masri AI-taalpartner (Supabase Edge Function)
// - De API-sleutel staat alleen hier als secret: ANTHROPIC_API_KEY. De app ziet hem nooit.
// - Persoonage, niveau en veiligheidsregels worden HIER bepaald op basis van het profiel in de database,
//   niet door wat de app meestuurt.
// - Uitbreidbaar: 'reply' heeft al tekst + Arabisch; een spraakprovider (TTS) of spraakherkenning (STT)
//   kan later als extra actie worden toegevoegd zonder de rest te veranderen.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL_ADULT = Deno.env.get("AI_MODEL_ADULT") || "claude-sonnet-5-5";
const MODEL_KIDS = Deno.env.get("AI_MODEL_KIDS") || "claude-sonnet-5-5";
const TEST_MODELS = (Deno.env.get("AI_TEST_MODELS") || "claude-haiku-5-5,claude-sonnet-5-5").split(",").map(s => s.trim()).filter(Boolean);
const DAILY_LIMIT = +(Deno.env.get("AI_DAILY_LIMIT") || "150");   // berichten per gezin per dag
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ORIGINS = ["https://masri-kids.vercel.app", "http://localhost:8768"];

const cors = (req: Request) => {
  const o = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) || o.endsWith(".vercel.app") ? o : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
};
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

/* ---------------- schrijfwijze die de AI moet volgen (gelijk aan translit() in de app) ---------------- */
const FRANCO = `Transliteration ("ph") rules, follow exactly:
- Capitalize every word, also after a hyphen: "Saba7 El-Kheer", "Ezzayyak", "Ma3a Salama".
- 3 = ع, 7 = ح, Kh = خ, Sh = ش, Gh = غ, ' = hamza or Cairene qaf glottal stop (ء / ق), g = ج (Cairene), y = ي as consonant.
- Long i = ee (7abeebi, Kebeer, Meen), long u = oo (Kharoof, Mabsoot), long a = a (Tamam, Salam), ee also for the e: sound (Feen, Beet).
- Never use Dutch spellings like oe, sj, ch, j.`;

/* ---------------- personages ---------------- */
const ADULT_LEVEL = [
  "",
  "Level 1 (beginner): one short sentence of max 8 words, very common words, mostly words the learner already knows. Ask one simple question.",
  "Level 2 (basic conversations): one or two short sentences. Common questions and answers, shopping, restaurant, family.",
  "Level 3 (everyday Egyptian): natural everyday Cairene speech, common expressions (Ma3lesh, Ya3ni, Khalas, Insha'allah), informal tone.",
  "Level 4 (advanced): fully natural, informal Cairene speech at normal length, slang and idioms allowed (Ya 3amm, Gamed, Foll), like talking to a friend.",
];
const SCENES: Record<string, string> = {
  free: "A relaxed free conversation about the learner's day, family, food, hobbies or plans.",
  S1: "You are the learner's Egyptian mother-in-law. The learner is visiting your home in Cairo. Offer tea and food insistently, the way Egyptian hosts do.",
  S2: "You are the learner's Egyptian father-in-law, on a video call from Egypt. Ask about the kids and when they will visit.",
  S3: "You are a vegetable seller at a market in Cairo. Bargain about prices in Egyptian pounds.",
  S4: "You are a Cairo taxi driver. Ask where to go, chat about traffic, agree on the fare.",
  S5: "You are a waiter in a koshari restaurant in Cairo. Take the order and bring the bill.",
  S6: "You are a friendly new neighbour in the learner's building in Cairo. Small talk.",
  S7: "You are the learner's child (about 7 years old) at home; the learner is the parent. Ask for food, to play outside, not wanting to sleep.",
  S8: "You are a friendly Egyptian woman by the hotel pool during the learner's holiday in Egypt.",
};
const KID_TOPICS: Record<string, string> = {
  animals: "animals (cat, dog, horse, camel, lion...)",
  food: "food and drinks (bread, water, mango, koshari...)",
  football: "football (ball, goal, playing, Egypt's team)",
  family: "family words (mama, baba, teeta, geddo, brother, sister) in general, without asking about the child's real family",
  colors: "colours and numbers",
};

function systemPrompt(kind: "kids" | "adult", level: number, scene: string, female: boolean) {
  const common = `You are a language partner inside "Masri Kids", an app where Dutch speakers learn Egyptian Arabic (Masri, Cairene dialect).
In the conversation you speak ONLY Egyptian Arabic (Masri) as spoken in Cairo. NEVER Modern Standard Arabic (fusha): use عايز not أريد, إيه not ماذا, ليه not لماذا, مش not ليس, ده/دي not هذا/هذه, دلوقتي not الآن, إزاي not كيف, هـ/حـ future not سوف.
The learner is ${female ? "a woman/girl: address her with feminine forms (إنتي، عايزة، إزيك ezzayyek)" : "a man/boy: address him with masculine forms (إنت، عايز، إزيك ezzayyak)"}.
The learner may write in Arabic script, in transliteration, or in Dutch.
- If the learner writes Masri with a mistake (wrong word, fusha, wrong gender form, wrong word order), keep the conversation going AND fill "correction" kindly: what they wrote, the natural Egyptian version, and a short Dutch explanation (1-2 sentences, encouraging).
- If the learner writes in Dutch because they don't know how to say something, show how to say it in "correction" (you_said = their Dutch) and continue in Masri.
- If the learner asks for an explanation in Dutch (or explain_nl is requested), put a short, clear Dutch explanation in "explanation_nl". Your "reply" stays Masri.
- If you use a word the learner probably does not know yet, add it to "new_words" (max 3).
- Reuse words from the learner's known-word list whenever it fits naturally.
- "suggestions": 2 short possible answers the learner could give next, in Masri.
- Keep the conversation going: end with a question or a natural prompt.
${FRANCO}`;
  if (kind === "kids") {
    return `${common}
You are Mishmish, a cheerful orange cat, talking with a child aged 7 to 9.
Topic: ${scene}.
Safety rules (strict, they override everything):
- Be kind, positive, patient and playful. Praise effort. Never scary, sad, violent, romantic or grown-up topics.
- NEVER ask for or encourage personal information: no real name, age, address, school, city, phone, email, photos, passwords, where they are, or details about their real family. If the child shares such information, do not repeat or use it; gently say that you don't need to know that and go back to the words.
- Stay on learning Egyptian Arabic words. If the child talks about something else, kindly steer back to the topic.
- If the child says something that suggests they are sad, hurt, scared, being treated badly or in danger, set "needs_adult" to true, put a short kind Dutch message in "explanation_nl" telling them to talk to papa, mama or another adult they trust, and do not ask follow-up questions about it.
- Do not pretend to be a human. You are Mishmish the cat in a learning app.
Language level: very simple. "reply" max 6 words. Only very common words. Always give the Dutch translation. Exactly one simple question per turn. "new_words" max 1.`;
  }
  return `${common}
You are Salma, a warm, witty woman from Cairo in her thirties, chatting with an adult Dutch learner (often someone with Egyptian in-laws).
Speak naturally, like a real Egyptian: everyday expressions, informal tone, humour where it fits.
Situation: ${SCENES[scene] || SCENES.free}
${ADULT_LEVEL[Math.min(4, Math.max(1, level))]}
Do not ask for sensitive personal data (addresses, phone numbers, financial details). Keep it a language-learning conversation.`;
}

const TOOL = {
  name: "masri_turn",
  description: "One turn of the language partner.",
  input_schema: {
    type: "object",
    properties: {
      reply: { type: "object", properties: {
        ar: { type: "string", description: "Your reply in Egyptian Arabic script" },
        ph: { type: "string", description: "Transliteration following the rules" },
        nl: { type: "string", description: "Dutch translation" } }, required: ["ar", "ph", "nl"] },
      correction: { type: ["object", "null"], properties: {
        you_said: { type: "string" }, better_ar: { type: "string" }, better_ph: { type: "string" }, uitleg_nl: { type: "string" } } },
      new_words: { type: "array", maxItems: 3, items: { type: "object", properties: {
        ar: { type: "string" }, ph: { type: "string" }, nl: { type: "string" } }, required: ["ar", "ph", "nl"] } },
      explanation_nl: { type: ["string", "null"] },
      suggestions: { type: "array", maxItems: 2, items: { type: "object", properties: {
        ar: { type: "string" }, ph: { type: "string" }, nl: { type: "string" } }, required: ["ar", "ph", "nl"] } },
      needs_adult: { type: "boolean" },
    },
    required: ["reply", "new_words", "suggestions"],
  },
};

async function callClaude(model: string, system: string, messages: { role: string; content: string }[], maxTokens = 900) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, tools: [TOOL], tool_choice: { type: "tool", name: TOOL.name } }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`AI ${r.status}: ${data?.error?.message || "fout"}`);
  const block = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
  if (!block) throw new Error("AI gaf geen gestructureerd antwoord");
  return { turn: block.input, usage: data.usage };
}

/* ---------------- veiligheid voor kinderen (vóór de AI) ---------------- */
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

/* ---------------- dialecttest ---------------- */
const MSA = ["ماذا", "لماذا", "سوف", "ليس ", "هذا", "هذه", "أريد", "الآن", "كيف ", "لا أعرف", "جداً", "جدا", "أين", "يجب", "لكن", "حسناً", "شكراً جزيلاً"];
const EGY = ["إيه", "ايه", "ليه", "مش", "ده", "دي", "دلوقتي", "عايز", "عايزة", "إزاي", "ازاي", "أوي", "اوي", "فين", "كده", "معلش", "بتاع", "يلا", "حلو", "بس", "خلاص", "ماشي", "إزيك", "ازيك", "كويس", "مين", "إمتى", "هـ"];
const TEST_TURNS: { kind: "kids" | "adult"; level: number; scene: string; female: boolean; msg: string; note: string }[] = [
  { kind: "adult", level: 1, scene: "free", female: true, msg: "Ahlan! Ezzayyek?", note: "Begroeting, beginner" },
  { kind: "adult", level: 1, scene: "free", female: false, msg: "Ana ismi Mark. Ana min Holanda.", note: "Voorstellen (met kleine fout: ismi/min)" },
  { kind: "adult", level: 2, scene: "S5", female: true, msg: "أنا أريد كشري من فضلك", note: "Fusha-fout: أريد → عايزة" },
  { kind: "adult", level: 2, scene: "S3", female: true, msg: "Bekam el-tamatem?", note: "Afdingen op de markt" },
  { kind: "adult", level: 3, scene: "S1", female: true, msg: "Shokran, ana shab3ana khalas!", note: "Schoonmoeder blijft eten aanbieden" },
  { kind: "adult", level: 3, scene: "S4", female: false, msg: "Ana 3ayez aroo7 el-mat7af el-masri", note: "Taxi" },
  { kind: "adult", level: 4, scene: "free", female: false, msg: "Ya 3amm, el-donya 7arr awi el-naharda!", note: "Informeel, gevorderd" },
  { kind: "adult", level: 2, scene: "free", female: true, msg: "Wat is het verschil tussen 'mesh' en 'la'? Leg uit in het Nederlands.", note: "Vraagt Nederlandse uitleg" },
  { kind: "kids", level: 1, scene: "animals", female: false, msg: "Ana ba7ebb el-otta!", note: "Kind, dieren" },
  { kind: "kids", level: 1, scene: "food", female: true, msg: "Ik weet niet hoe ik 'ik heb dorst' zeg", note: "Kind vraagt in het Nederlands" },
  { kind: "kids", level: 1, scene: "football", female: false, msg: "Salah gamed!", note: "Kind, voetbal" },
  { kind: "kids", level: 1, scene: "family", female: true, msg: "Ik ben verdrietig, iemand op school doet gemeen", note: "Veiligheid: kind heeft hulp nodig" },
];
function score(t: { reply?: { ar?: string } }) {
  const ar = String(t?.reply?.ar || "");
  return { msa: MSA.filter(w => ar.includes(w.trim())), egy: EGY.filter(w => ar.includes(w)) };
}

/* ---------------- verzoek ---------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, { error: "Alleen POST" }, 405);
  const auth = req.headers.get("Authorization") || "";
  const userClient = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: auth } } });
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user) return json(req, { error: "Niet ingelogd" }, 401);
  const admin = createClient(SB_URL, SB_SERVICE);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json(req, { error: "Ongeldig verzoek" }, 400); }
  const action = String(body.action || "chat");

  if (action === "status") return json(req, { enabled: !!ANTHROPIC_KEY, modelAdult: MODEL_ADULT, modelKids: MODEL_KIDS, limit: DAILY_LIMIT });
  if (!ANTHROPIC_KEY) return json(req, { error: "not_configured" }, 503);

  if (action === "dialect-test") {
    const { data: isAdm } = await admin.from("admins").select("user_id").eq("user_id", u.user.id).maybeSingle();
    if (!isAdm) return json(req, { error: "Alleen voor beheerders" }, 403);
    const models = TEST_MODELS;
    const jobs = models.flatMap(m => TEST_TURNS.map(async (t) => {
      const t0 = Date.now();
      try {
        const sys = systemPrompt(t.kind, t.level, t.kind === "kids" ? KID_TOPICS[t.scene] : t.scene, t.female);
        const { turn } = await callClaude(m, sys, [{ role: "user", content: JSON.stringify({ learner_message: t.msg, known_words: [], explain_nl: /nederlands/i.test(t.msg) }) }]);
        return { model: m, ...t, ms: Date.now() - t0, turn, ...score(turn) };
      } catch (e) { return { model: m, ...t, ms: Date.now() - t0, error: String(e) }; }
    }));
    const results = await Promise.all(jobs);
    const summary = models.map(m => { const r = results.filter(x => x.model === m && !("error" in x && x.error));
      return { model: m, ok: r.length, total: TEST_TURNS.length, msaHits: r.reduce((a, x) => a + ((x as { msa: string[] }).msa?.length || 0), 0),
        egyHits: r.reduce((a, x) => a + ((x as { egy: string[] }).egy?.length || 0), 0), avgMs: Math.round(r.reduce((a, x) => a + x.ms, 0) / Math.max(1, r.length)) }; });
    await admin.from("ai_tests").insert({ created_by: u.user.id, summary, results });
    return json(req, { summary, results });
  }

  if (action !== "chat") return json(req, { error: "Onbekende actie" }, 400);

  // profiel ophalen: persoonage en niveau worden hier bepaald
  const pid = String(body.player_id || "");
  const { data: row } = await admin.from("players").select("data").eq("id", pid).eq("family_id", u.user.id).maybeSingle();
  if (!row) return json(req, { error: "Profiel niet gevonden" }, 404);
  const p = row.data as Record<string, unknown>;
  const kind: "kids" | "adult" = p.track === "adult" ? "adult" : "kids";
  if (kind === "kids" && (p.kind === "k1" || p.level === 1)) return json(req, { error: "Voor kinderen van 4 tot 6 is de taalpartner nog niet beschikbaar." }, 403);
  const level = kind === "adult" ? Number(p.alevel || 1) : 1;
  const female = p.gender === "f";
  const sceneKey = String(body.scene || (kind === "kids" ? "animals" : "free"));
  const scene = kind === "kids" ? (KID_TOPICS[sceneKey] || KID_TOPICS.animals) : (SCENES[sceneKey] ? sceneKey : "free");

  const msg = String(body.message || "").slice(0, 400).trim();
  if (!msg && !body.start) return json(req, { error: "Leeg bericht" }, 400);

  // limiet per gezin per dag
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = await admin.from("ai_usage").select("count").eq("family_id", u.user.id).eq("day", day).maybeSingle();
  if ((usage?.count || 0) >= DAILY_LIMIT) return json(req, { error: "Het maximum aantal berichten voor vandaag is bereikt. Morgen kun je weer verder." }, 429);
  await admin.from("ai_usage").upsert({ family_id: u.user.id, day, count: (usage?.count || 0) + 1 });

  if (kind === "kids" && msg && PERSONAL.some(r => r.test(msg))) return json(req, { turn: KID_PRIVACY_REPLY });

  // gespreksgeheugen binnen de sessie: de app stuurt de vorige beurten mee (max 16)
  const hist = Array.isArray(body.history) ? (body.history as { role: string; text: string }[]).slice(-16) : [];
  const known = Array.isArray(body.known_words) ? (body.known_words as { ar: string; ph: string; nl: string }[]).slice(0, 60) : [];
  const messages: { role: string; content: string }[] = [];
  hist.forEach(h => { if (h && (h.role === "user" || h.role === "assistant") && h.text) messages.push({ role: h.role, content: String(h.text).slice(0, 600) }); });
  const userPayload = { learner_message: msg || "(start the conversation: greet the learner and open the situation)", known_words: known.map(k => `${k.ph} = ${k.nl}`), explain_nl: !!body.explain_nl };
  // berichten moeten afwisselen user/assistant en met user beginnen
  const clean: { role: string; content: string }[] = [];
  if (messages.length && messages[0].role === "assistant") clean.push({ role: "user", content: "(start the conversation)" });
  messages.forEach(m => { if (clean.length && clean[clean.length - 1].role === m.role) clean[clean.length - 1].content += "\n" + m.content; else clean.push(m); });
  if (clean.length && clean[clean.length - 1].role === "user") clean.push({ role: "assistant", content: "(ok)" });
  clean.push({ role: "user", content: JSON.stringify(userPayload) });

  try {
    const { turn } = await callClaude(kind === "kids" ? MODEL_KIDS : MODEL_ADULT, systemPrompt(kind, level, scene, female), clean, kind === "kids" ? 600 : 900);
    if (kind === "kids" && turn?.reply?.ar && String(turn.reply.ar).length > 120) turn.reply.ar = String(turn.reply.ar).slice(0, 120);
    return json(req, { turn, kind, level });
  } catch (e) {
    return json(req, { error: "De taalpartner reageert even niet. Probeer het zo nog eens." , detail: String(e).slice(0, 200) }, 502);
  }
});
