// Automatische basiscontroles voor Masri Kids. Draai met: node tests/check.mjs
// Raakt geen database of gebruikersgegevens aan; leest alleen bestanden.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FOUT'} ${msg}`); if (!cond) fails++; };

// 1. Alle ingebouwde scripts moeten geldige JavaScript zijn (vangt tikfouten die de hele app breken).
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
ok(scripts.length > 0, `ingebouwde scripts gevonden (${scripts.length})`);
scripts.forEach((code, i) => {
  try { new vm.Script(code, { filename: `index.html#script${i + 1}` }); ok(true, `script ${i + 1} heeft geen syntaxfouten`); }
  catch (e) { ok(false, `script ${i + 1}: ${e.message}`); }
});

// 2. Geen geheimen in welk bestand dan ook dat in de repository staat.
//    (De publieke 'sb_publishable_'-sleutel mag wel: die is bedoeld voor de app.)
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter(f => f !== 'tests/check.mjs'); // dit bestand bevat de zoekpatronen zelf
const SECRETS = [
  ['Anthropic API-sleutel', /sk-ant-[\w-]{10,}/],
  ['OpenAI-achtige API-sleutel', /\bsk-(proj-)?[A-Za-z0-9]{20,}/],
  ['geheime Supabase-sleutel', /sb_secret_[\w-]{10,}/],
  ['Supabase service_role-sleutel', /eyJhbGciOi[\w-]+\.eyJ[\w-]*cm9sZSI6InNlcnZpY2Vfcm9sZS[\w-]*/],
  ['GitHub-token', /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/],
  ['privésleutel', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['database-wachtwoord in adres', /postgres(ql)?:\/\/[^:\s]+:[^@\s]+@/],
];
let scanned = 0, found = 0;
for (const f of tracked) {
  const buf = readFileSync(join(root, f));
  if (buf.includes(0)) continue; // afbeeldingen e.d. overslaan
  scanned++;
  const txt = buf.toString('utf8');
  for (const [name, re] of SECRETS) if (re.test(txt)) { found++; ok(false, `${name} gevonden in ${f}`); }
}
if (!found) ok(scanned > 0, `geen geheimen gevonden in ${scanned} tekstbestanden`);

// 2b. De AI-functie (TypeScript) en manifest.json moeten geldig zijn.
const tmp = mkdtempSync(join(tmpdir(), 'masri-check-'));
for (const f of tracked.filter(f => f.endsWith('.ts'))) {
  try {
    const js = stripTypeScriptTypes(readFileSync(join(root, f), 'utf8'));
    const out = join(tmp, f.replace(/[\/]/g, '_') + '.mjs');
    writeFileSync(out, js);
    execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' });
    ok(true, `${f} heeft geen syntaxfouten`);
  } catch (e) { ok(false, `${f}: ${String(e.stderr || e.message).split('\n').slice(0, 5).join(' ')}`); }
}
rmSync(tmp, { recursive: true, force: true });
try { JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')); ok(true, 'manifest.json is geldig'); }
catch (e) { ok(false, `manifest.json: ${e.message}`); }

// 3. De veilige weergavefunctie bestaat en werkt.
const escSrc = html.match(/const esc = s => [^\n]+/);
ok(!!escSrc, 'esc()-functie aanwezig');
if (escSrc) {
  const esc = vm.runInNewContext(escSrc[0].replace('const esc =', '(').replace(/;\s*$/, '') + ')');
  ok(esc('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;', 'esc() maakt HTML onschadelijk');
  ok(esc('"\'&') === '&quot;&#39;&amp;', 'esc() behandelt aanhalingstekens en &');
}

// 4. Welke database bij welk adres hoort, controleert tests/omgeving.mjs (draait ook automatisch).
ok(html.includes("live: { url:'https://udiqtseewsifcmxsrwtu.supabase.co'"), 'live Supabase-adres ongewijzigd');

// 5. Inhoud uit de database wordt ontdaan van HTML voordat die in de app komt.
const noHtmlSrc = html.match(/const noHtml = [^\n]+/);
ok(!!noHtmlSrc, 'noHtml()-filter voor databaseinhoud aanwezig');
if (noHtmlSrc) {
  const noHtml = vm.runInNewContext('(' + noHtmlSrc[0].replace('const noHtml =', '').replace(/;\s*$/, '') + ')');
  ok(noHtml('<img src=x onerror=alert(1)>كلب') === 'img src=x onerror=alert(1)كلب', 'noHtml() verwijdert < en >');
  ok(noHtml('Saba7 El-Kheer') === 'Saba7 El-Kheer' && noHtml(3) === 3, 'noHtml() laat gewone tekst en getallen heel');
}

// 6. Privacy: verklaring bestaat, is vanuit de app bereikbaar, en is volledig ingevuld.
let privacy = '';
try { privacy = readFileSync(join(root, 'privacy.html'), 'utf8'); } catch { /* ontbreekt */ }
ok(!!privacy, 'privacy.html bestaat');
ok((html.match(/href="\/privacy\.html"/g) || []).length >= 3, 'privacyverklaring gelinkt bij aanmelden, inloggen en in Ouders → Account');
const open_ = (privacy.match(/\{\{[A-Z_]+\}\}/g) || []);
ok(open_.length === 0, open_.length ? `privacyverklaring nog niet ingevuld: ${[...new Set(open_)].join(', ')}` : 'privacyverklaring volledig ingevuld');
ok(/data-act="delacc-ask"/.test(html) && /functions\.invoke\('delete-account'/.test(html), 'knop "Account verwijderen" aanwezig');

// 7. Bij het openen van de app geen verbindingen met Google Fonts, jsDelivr of andere CDN's:
//    lettertypen en de Supabase-bibliotheek staan in de app zelf.
const CDN = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com/;
ok(!CDN.test(html) && !CDN.test(privacy), 'geen verwijzingen naar Google Fonts of een CDN in index.html en privacy.html');
const loads = [...html.matchAll(/<(?:script[^>]*\bsrc|link[^>]*\bhref)="([^"]+)"/g)].map(m => m[1]);
const extern = loads.filter(u => /^(https?:)?\/\//.test(u));
ok(extern.length === 0, extern.length ? `externe bestanden in index.html: ${extern.join(', ')}` : 'alle scripts en stijlbestanden in index.html zijn lokaal');
let fontsCss = '';
try { fontsCss = readFileSync(join(root, 'fonts/fonts.css'), 'utf8'); } catch { /* ontbreekt */ }
const fontFiles = [...fontsCss.matchAll(/url\(([^)]+)\)/g)].map(m => m[1]);
const missing = fontFiles.filter(u => { try { readFileSync(join(root, u)); return false; } catch { return true; } });
ok(fontFiles.length > 0 && missing.length === 0 && !/https?:/.test(fontsCss),
  missing.length ? `lettertypebestanden ontbreken: ${missing.join(', ')}` : `lettertypen lokaal aanwezig (${new Set(fontFiles).size} bestanden)`);
const sbLib = 'vendor/supabase-js-2.45.4/supabase.js';
ok(html.includes(`<script src="/${sbLib}"></script>`), 'Supabase-bibliotheek wordt lokaal geladen');
let sbHash = '';
try { sbHash = createHash('sha256').update(readFileSync(join(root, sbLib))).digest('hex'); } catch { /* ontbreekt */ }
// Vingerafdruk van dist/umd/supabase.js uit het officiële npm-pakket @supabase/supabase-js@2.45.4
ok(sbHash === '8596965fe918e656600a1b568d3a168f5c0d3d22a600886bb6f44a6555db01e7', 'Supabase-bibliotheek is ongewijzigd (gelijk aan npm 2.45.4)');
const licences = ['fonts/OFL-baloo-bhaijaan-2.txt', 'fonts/OFL-nunito.txt', 'vendor/supabase-js-2.45.4/LICENSE'];
ok(licences.every(f => { try { return readFileSync(join(root, f), 'utf8').length > 500; } catch { return false; } }), 'licentieteksten van lettertypen en bibliotheek aanwezig');

// 8. AI-taalpartner: zolang de AI uit staat kan niemand hem gebruiken, ook de beheerder niet,
//    tenzij de server-instelling AI_ADMIN_PREVIEW op "aan" staat. Test de regels zelf (access.ts),
//    hoe de serverfunctie ze gebruikt, en wat de app laat zien. Geen database of AI nodig.
const aiDir = join(root, 'supabase/functions/ai-chat');
const aiSrc = readFileSync(join(aiDir, 'index.ts'), 'utf8');
const tmpA = mkdtempSync(join(tmpdir(), 'masri-ai-'));
let acc = null;
try {
  writeFileSync(join(tmpA, 'access.mjs'), stripTypeScriptTypes(readFileSync(join(aiDir, 'access.ts'), 'utf8')));
  acc = await import(join(tmpA, 'access.mjs'));
} catch (e) { ok(false, `access.ts laden: ${e.message}`); }
rmSync(tmpA, { recursive: true, force: true });
if (acc) {
  const P = acc.previewAllowed;
  ok(P(undefined) === false && P(null) === false && P('') === false, 'proefmodus staat uit als AI_ADMIN_PREVIEW niet is ingesteld');
  ok(['uit', 'true', '1', 'yes', 'on', 'aan!', 'niet aan'].every(v => P(v) === false), 'proefmodus gaat alleen aan met precies "aan" (niet met true, 1, on, ...)');
  ok(P('aan') === true && P(' AAN ') === true, 'proefmodus gaat aan met "aan"');
  const C = (action, active, isAdmin, preview) => acc.canUseAi({ action, active, isAdmin, preview }).ok;
  const combos = [];
  for (const active of [false, true]) for (const isAdmin of [false, true]) for (const preview of [false, true]) combos.push([active, isAdmin, preview]);
  ok(combos.filter(([a]) => !a).every(([a, ad, pr]) => C('chat', a, ad, pr) === (ad && pr)), 'chat met AI uit: alleen beheerder met proefmodus aan');
  ok(combos.filter(([a, ad]) => !a && !ad).every(([a, ad, pr]) => !C('chat', a, ad, pr)), 'chat met AI uit: gewone gebruikers altijd geblokkeerd, ook met proefmodus aan');
  ok(!C('chat', false, true, false), 'chat met AI uit: beheerder geblokkeerd als proefmodus uit staat');
  ok(combos.filter(([a]) => a).every(([a, ad, pr]) => C('chat', a, ad, pr)), 'chat met AI aan: iedereen mag (zoals voorheen)');
  ok(combos.every(([a, ad, pr]) => C('dialect-test', a, ad, pr) === (ad && pr)), 'dialecttest: alleen beheerder met proefmodus aan');
  ok(!C('onbekend', true, true, true) && !C('', true, true, true), 'onbekende actie wordt geweigerd');
  ok(!C('chat', 'true', 'true', 'true') && !C('dialect-test', 1, 1, 1), 'alleen echte ja/nee-waarden tellen (geen "true" of 1)');
}
// hoe de serverfunctie de regels gebruikt
const aiHead = aiSrc.slice(aiSrc.indexOf('Deno.serve'));
const at = s => aiHead.indexOf(s);
ok(/const preview = previewAllowed\(Deno\.env\.get\("AI_ADMIN_PREVIEW"\)\)/.test(aiSrc), 'ai-chat leest proefmodus alleen uit de server-instelling AI_ADMIN_PREVIEW');
ok(!/body\.(preview|admin|isAdmin|active|admin_preview)\b/.test(aiSrc), 'ai-chat gebruikt geen proefmodus, beheerder of activering uit het verzoek');
ok(!/!active && !isAdmin/.test(aiSrc), 'oude beheerder-uitzondering is verwijderd');
ok(/admin_preview: isAdmin && preview/.test(aiSrc), 'status meldt of proefmodus is toegestaan (alleen voor de beheerder)');
const iAccess = at('canUseAi({ action, active, isAdmin, preview })');
ok(iAccess > 0 && (aiHead.match(/canUseAi\(/g) || []).length === 1, 'ai-chat controleert de toegang op één plek');
ok(iAccess > 0 && at('if (!provider.configured())') > iAccess && at('provider.turn(') > iAccess && at('await monthTokens(admin)') > iAccess,
  'toegang wordt gecontroleerd vóór sleutel, budget en elke aanroep naar de AI');
ok(at('if (action !== "chat" && action !== "dialect-test")') > 0 && at('if (action !== "chat" && action !== "dialect-test")') < iAccess,
  'alleen de acties status, chat en dialect-test bestaan');
ok(at('if (action === "status")') > 0 && !aiHead.slice(at('if (action === "status")'), iAccess).includes('provider.turn('), 'status stuurt niets naar de AI');
// wat de app laat zien
const appAi = (html.match(/const aiPreview = [^\n]+\n(?:const aiCan = [^\n]+)/) || [''])[0];
ok(/AI\.st\.admin_preview===true && AUTH\.admin/.test(appAi) && /aiActiveFor\(p\) \|\| aiPreview\(\)/.test(appAi), 'app toont proefgesprekken alleen als de server proefmodus toestaat');
ok(!/aiActiveFor\(p\) \|\| AUTH\.admin/.test(html), 'app laat de beheerder niet meer standaard chatten');
ok(/\$\{aiPreview\(\)\?`<button class="btn" data-act="ai-test"/.test(html) && /async function aiRunTest\(\)\{\n  if\(!aiPreview\(\)\)/.test(html), 'app toont de dialecttest alleen als proefmodus is toegestaan');
if (appAi) {
  const ctx = { AI: {}, AUTH: {} };
  const app = vm.runInNewContext(`const aiKidAge = p => p.kind ? p.kind==='k2' : p.level===2;
const aiActiveFor = p => !!AI.st && (p.track==='adult' ? AI.st.active_adult : AI.st.active_kids);
${appAi}; ({ aiCan, aiPreview })`, ctx);
  const can = (st, admin, p) => { ctx.AI.enabled = true; ctx.AI.st = st; ctx.AUTH.admin = admin; return app.aiCan(p); };
  const adult = { track: 'adult' }, kid = { kind: 'k2', aiAllowed: true };
  const off = { active_adult: false, active_kids: false };
  ok(!can({ ...off, admin_preview: false }, true, adult) && !can({ ...off, admin_preview: false }, true, kid), 'app: beheerder ziet geen chat als AI en proefmodus uit staan');
  ok(!can({ ...off, admin_preview: true }, false, adult) && !can({ ...off, admin_preview: 'true' }, true, adult), 'app: gewone gebruiker ziet geen chat; alleen echte true telt');
  ok(can({ ...off, admin_preview: true }, true, adult), 'app: beheerder ziet chat als proefmodus aan staat');
  ok(can({ active_adult: true, active_kids: false }, false, adult) && !can({ active_adult: true, active_kids: false }, false, kid), 'app: met AI aan voor volwassenen ziet een gewone gebruiker alleen de chat voor volwassenen');
}

// 9. TESTMODUS: alleen in de testomgeving en alleen voor de beheerder; wordt nergens bewaard
//    en verandert de spelregels voor gewone gebruikers niet.
const tmSrc = ['let TESTMODE_ON', 'const testModeAllowed', 'const testMode ', 'function worldUnlocked', 'function lessonUnlocked']
  .map(k => (html.match(new RegExp('^' + k.replace(/[()]/g, '\\$&') + '[^\\n]*', 'm')) || [''])[0]);
ok(tmSrc.every(Boolean), 'testmodus-code gevonden');
ok(/const testModeAllowed = \(\) => SB_ENV === 'test' && AUTH\.admin === true;/.test(html), 'testmodus alleen toegestaan in de testomgeving én voor de beheerder');
ok(/const testMode = \(\) => TESTMODE_ON === true && testModeAllowed\(\);/.test(html), 'testmodus werkt alleen als hij toegestaan is (ook als hij per ongeluk aan staat)');
ok(!/unlockAll\s*=\s*.*TESTMODE|TESTMODE[^\n]*(localStorage|sessionStorage|save\(\)|\.upsert|\.update\()/.test(html), 'testmodus wordt nergens bewaard en verandert geen profiel');
ok(/AUTH\.admin = false; TESTMODE_ON = false;/.test(html), 'testmodus gaat uit bij opnieuw inloggen of uitloggen');
if (tmSrc.every(Boolean)) {
  const env = { SB_ENV: 'test', AUTH: { admin: false }, WORLDS: [{ id: 1, lessons: [{ id: 'a' }, { id: 'b' }] }, { id: 2, lessons: [{ id: 'c' }, { id: 'd' }] }],
    prevWorld: (p, wi) => wi - 1 };
  vm.createContext(env);
  vm.runInContext(tmSrc.join('\n') + '\nthis.api = { worldUnlocked, lessonUnlocked, testMode, setOn: v => { TESTMODE_ON = v; } };', env);
  const { api } = env;
  const kid = { unlockAll: false, lessons: {} };
  const open = () => api.worldUnlocked(kid, 1) && api.lessonUnlocked(kid, 0, 1);
  const zet = (envName, admin, on) => { env.SB_ENV = envName; env.AUTH.admin = admin; api.setOn(on); };
  zet('test', false, false); ok(!open(), 'testmodus uit: lessen blijven op slot (gewone spelregels)');
  zet('test', true, true); ok(open() && api.testMode(), 'beheerder in testomgeving met testmodus aan: alles open');
  zet('test', false, true); ok(!open(), 'gewone gebruiker in testomgeving: testmodus werkt niet');
  zet('live', true, true); ok(!open() && !api.testMode(), 'live (masri-kids.vercel.app): testmodus werkt nooit, ook niet voor de beheerder');
  zet('test', true, false); ok(!open(), 'beheerder met testmodus uit: gewone spelregels');
  zet('test', true, true); kid.lessons = {}; api.lessonUnlocked(kid, 0, 1); ok(Object.keys(kid.lessons).length === 0 && kid.unlockAll === false, 'testmodus verandert de voortgang en het profiel niet');
}
ok(/\$\{testModeAllowed\(\) \? `<div class="panel" id="testmode-panel">/.test(html) && /case 'testmode': if\(testModeAllowed\(\)\)/.test(html), 'schakelaar alleen zichtbaar en bruikbaar als testmodus toegestaan is');

// 10. Snelle reparaties (ontwerpaudit november 2026)
// 10a. Mijn woordjes: Arabisch staat op een eigen regel in de middenkolom, zodat het de uitspraak niet overlapt.
const wordsFn = (html.match(/function wordsHTML\(\)\{[\s\S]*?\n\}/) || [''])[0];
ok(/<div class="mid"><div class="ar" lang="ar" dir="rtl">\$\{x\.ar\}<\/div><div class="ph">/.test(wordsFn) && !/<\/div><\/div><span class="ar" lang="ar">\$\{x\.ar\}/.test(wordsFn),
  'Mijn woordjes: Arabisch op eigen regel, niet meer naast de uitspraak');
// 10b. Startscherm: geen effen grijze balk onder Mishmish.
const sunAfter = (html.match(/\.sun-disc::after\{[^}]*\}/) || [''])[0];
ok(sunAfter && !/linear-gradient\(var\(--sand-2\)/.test(sunAfter), 'startscherm: geen grijze balk onder Mishmish');
// 10c. Koppelen: nooit twee woorden met dezelfde betekenis.
const mkSrc = ['const nlLabel', 'const nlBare', 'const meaningClash', 'function matchIds'].map(k => (html.match(new RegExp('^' + k + '[^\\n]*', 'm')) || [''])[0]);
ok(mkSrc.every(Boolean) && (html.match(/const m = matchIds\(ids, 4\); if\(m\.length>=3\)/g) || []).length === 3 && !/type:'match', ids:sample\(/.test(html),
  'koppelopdrachten gebruiken overal matchIds, en alleen met minstens 3 paren');
if (mkSrc.every(Boolean)) {
  const ITEMS = { ahlan:{nl:'hallo'}, salam:{nl:'hallo (vrede zij met jullie)'}, aywa:{nl:'ja'}, la:{nl:'nee'}, bye:{nl:'doei!'}, shukran:{nl:'dank je wel'},
    khalo:{nl:'oom (broer van mama)'}, ammo:{nl:'oom (broer van papa)'}, khalto:{nl:'tante (zus van mama)'}, ammeto:{nl:'tante (zus van papa)'},
    sabah:{nl:'goedemorgen'}, sabahnoor:{nl:'Goedemorgen! (antwoord)'} };
  const ctx = vm.createContext({ ITEM: ITEMS, shuffle: a => [...a].sort(() => Math.random() - 0.5) });
  vm.runInContext(mkSrc.join('\n') + '\nthis.m = matchIds;', ctx);
  let ok1 = true, ok2 = true, ok3 = true;
  for (let i = 0; i < 30; i++) {
    const r = ctx.m(['ahlan', 'salam', 'aywa', 'la', 'bye', 'shukran'], 4);
    if ((r.includes('ahlan') && r.includes('salam')) || r.length !== 4) ok1 = false;
    if (ctx.m(['khalo', 'ammo', 'khalto', 'ammeto'], 4).length !== 4) ok2 = false;
    if (ctx.m(['ahlan', 'salam', 'sabah', 'sabahnoor'], 4).length !== 2) ok3 = false;
  }
  ok(ok1, 'koppelen: "hallo" en "hallo (vrede zij met jullie)" nooit samen; toch 4 paren');
  ok(ok2, 'koppelen: oom/tante van mama en van papa mogen wel samen (dat verschil is juist de les)');
  ok(ok3, 'koppelen: als er te weinig verschillende betekenissen zijn, wordt de opdracht kleiner (en dan overgeslagen)');
}
// 10d. Ouderslot: getallen in woorden, tweecijferige som.
const nlNumSrc = (html.match(/function nlNum\(n\)\{[\s\S]*?\n[^\n]*return u\[e\][^\n]*\}/) || [''])[0];
ok(!!nlNumSrc && /function newGate\(\)\{ const a=21\+/.test(html) && /\$\{nlNum\(g\.a\)\} \+ \$\{nlNum\(g\.b\)\}/.test(html), 'ouderslot: twee getallen in woorden (21–49 plus 12–29)');
if (nlNumSrc) {
  const c = vm.createContext({}); vm.runInContext(nlNumSrc + '\nthis.f = nlNum;', c);
  const want = { 21:'eenentwintig', 22:'tweeëntwintig', 23:'drieëntwintig', 30:'dertig', 37:'zevenendertig', 48:'achtenveertig', 12:'twaalf', 19:'negentien', 29:'negenentwintig' };
  ok(Object.entries(want).every(([n, w]) => c.f(+n) === w), 'ouderslot: Nederlandse getallen goed gespeld (o.a. tweeëntwintig, achtenveertig)');
}
// 10e. Kinderen 4–6: begroeting in het Nederlands, niet in Franco.
ok(/<b>\$\{p\.level===1 \? 'Hoi' : g\[1\]\}, \$\{esc\(p\.name\)\}!<\/b>/.test(html), 'dashboard 4–6 jaar: begroeting "Hoi" in plaats van Franco');

// 11. Design system fase 1: één kleurenset, geen Duolingo-kleuren, leesbaar contrast.
const cssAll = (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
const roots = [...cssAll.matchAll(/:root\{[^}]*\}/g)];
const mkRoot = roots.map(m => m[0]).find(r => r.includes('--mk-nile:')) || '';
ok(!!mkRoot && cssAll.lastIndexOf(mkRoot) > cssAll.lastIndexOf('--duo-line:#'), 'één merk-kleurenset (--mk-…) staat ná de oude lagen en wint dus');
const rules = roots.reduce((t, m) => t.replace(m[0], ''), cssAll);
const DUO = ['#1CB0F6', '#1899D6', '#84D8FF', '#DDF4FF', '#58CC02', '#58A700', '#89E219', '#A5ED6E', '#D7FFB8', '#FFC800', '#E0A800', '#FF4B4B', '#CE82FF', '#FF9600', '#3FBF48'];
const duoLeft = DUO.filter(c => new RegExp(c + '\\b', 'i').test(rules) || new RegExp(`color:'${c}'`, 'i').test(html));
ok(duoLeft.length === 0, duoLeft.length ? `nog Duolingo-kleuren in gebruik: ${duoLeft.join(', ')}` : 'geen Duolingo-kleuren meer in stijlregels en werelden');
const hexInRules = new Set((rules.match(/#[0-9A-Fa-f]{6}\b/g) || []).map(x => x.toUpperCase())).size;
ok(hexInRules <= 60, `aantal losse kleuren in stijlregels blijft beperkt (${hexInRules}, max 60)`);
const tok = n => ((mkRoot.match(new RegExp(`--mk-${n}:(#[0-9A-Fa-f]{6})`)) || [])[1]);
const lumi = h => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const contrast = (a, b) => { const [x, y] = [lumi(a), lumi(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [['ink', 'papyrus', 4.5], ['lapis', 'papyrus', 4.5], ['mute', 'white', 4.5], ['mute', 'papyrus', 4.5], ['nile-d', 'white', 4.5], ['nile-d', 'nile-soft', 4.5],
  ['saffron-t', 'saffron-soft', 4.5], ['ok-t', 'ok-bg', 4.5], ['ink', 'saffron', 4.5], ['white', 'nile', 3], ['white', 'clay', 3], ['white', 'ok', 3], ['white', 'lapis', 4.5]];
const weak = pairs.filter(([f, b, min]) => !(tok(f) && tok(b) && contrast(tok(f), tok(b)) >= min)).map(([f, b, min]) => `${f} op ${b} (<${min})`);
ok(weak.length === 0, weak.length ? `te weinig contrast: ${weak.join(', ')}` : 'contrast van alle tekstcombinaties voldoet (4,5 gewoon, 3 groot en vet)');
const worldCols = [...html.matchAll(/\{id:\d+, name:'[^']+',[^\n]*?color:'(#[0-9A-Fa-f]{6})'/g)].map(m => m[1]);
ok(worldCols.length === 13 && worldCols.every(c => contrast('#FFFFFF', c) >= 3), 'witte titels op alle 13 wereldkleuren minstens 3:1');

// 12. Nederlandse vertaling begint in de weergave met een hoofdletter; de opgeslagen woorden blijven gelijk.
const nlcSrc = (html.match(/^const nlc = [^\n]+/m) || [''])[0];
ok(!!nlcSrc, 'hulpfunctie voor hoofdletter in vertaling aanwezig');
if (nlcSrc) { const c = vm.createContext({}); vm.runInContext(nlcSrc + '\nthis.f = nlc;', c);
  ok(c.f('kat') === 'Kat' && c.f('falafel (ta\'meya)') === 'Falafel (ta\'meya)' && c.f('Dit is papa.') === 'Dit is papa.' && c.f('') === '' && c.f(undefined) === '', 'hoofdletter: "kat" wordt "Kat", rest blijft gelijk'); }
const rawNl = (html.match(/esc\([A-Za-z_][\w.\[\]]*?\.nl\)/g) || []);
ok(rawNl.length === 1 && /id="ce-nl" value="\$\{esc\(x\.nl\)\}"/.test(html), 'alle getoonde vertalingen met hoofdletter; alleen het bewerkveld voor de beheerder toont de opgeslagen tekst');
ok(!/nl:\s*nlc\(/.test(html) && /\{id:'otta',\s+w:3, ar:'قطة',\s+ph:'Otta',\s+nl:'kat'/.test(html), 'woordenlijst zelf ongewijzigd (alleen weergave)');

console.log(fails ? `\n${fails} controle(s) mislukt.` : '\nAlle controles geslaagd.');
process.exit(fails ? 1 : 0);
