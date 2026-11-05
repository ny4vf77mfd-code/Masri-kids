// Automatische basiscontroles voor Masri Kids. Draai met: node tests/check.mjs
// Raakt geen database of gebruikersgegevens aan; leest alleen bestanden.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FOUT'} ${msg}`); if (!cond) fails++; };

// 1. Alle ingebouwde scripts moeten geldige JavaScript zijn (vangt tikfouten die de hele app breken).
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
ok(scripts.length > 0, `ingebouwde scripts gevonden (${scripts.length})`);
scripts.forEach((code, i) => {
  try { new vm.Script(code, { filename: `index.html#script${i + 1}` }); ok(true, `script ${i + 1} heeft geen syntaxfouten`); }
  catch (e) { ok(false, `script ${i + 1}: ${e.message}`); }
});

// 2. Geen geheime sleutels in de frontend (alleen de publieke 'publishable' sleutel mag).
const all = [html, ...['supabase/functions/ai-chat/index.ts', 'supabase/functions/ai-chat/prompts.ts', 'supabase/functions/ai-chat/providers.ts']
  .map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8'))].join('\n');
ok(!/sk-ant-[\w-]{10,}/.test(all), 'geen Anthropic API-sleutel in de code');
ok(!/sb_secret_[\w-]{10,}/.test(all), 'geen geheime Supabase-sleutel in de code');
ok(!/eyJhbGciOi[\w-]+\.eyJ[\w-]*cm9sZSI6InNlcnZpY2Vfcm9sZS[\w-]*/.test(all), 'geen service_role-sleutel in de code');

// 3. De veilige weergavefunctie bestaat en werkt.
const escSrc = html.match(/const esc = s => [^\n]+/);
ok(!!escSrc, 'esc()-functie aanwezig');
if (escSrc) {
  const esc = vm.runInNewContext(escSrc[0].replace('const esc =', '(').replace(/;\s*$/, '') + ')');
  ok(esc('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;', 'esc() maakt HTML onschadelijk');
  ok(esc('"\'&') === '&quot;&#39;&amp;', 'esc() behandelt aanhalingstekens en &');
}

// 4. Verbonden met het verwachte Supabase-project.
ok(html.includes("const SB_URL = 'https://udiqtseewsifcmxsrwtu.supabase.co'"), 'Supabase-adres ongewijzigd');

// 5. Inhoud uit de database wordt ontdaan van HTML voordat die in de app komt.
const noHtmlSrc = html.match(/const noHtml = [^\n]+/);
ok(!!noHtmlSrc, 'noHtml()-filter voor databaseinhoud aanwezig');
if (noHtmlSrc) {
  const noHtml = vm.runInNewContext('(' + noHtmlSrc[0].replace('const noHtml =', '').replace(/;\s*$/, '') + ')');
  ok(noHtml('<img src=x onerror=alert(1)>كلب') === 'img src=x onerror=alert(1)كلب', 'noHtml() verwijdert < en >');
  ok(noHtml('Saba7 El-Kheer') === 'Saba7 El-Kheer' && noHtml(3) === 3, 'noHtml() laat gewone tekst en getallen heel');
}

console.log(fails ? `\n${fails} controle(s) mislukt.` : '\nAlle controles geslaagd.');
process.exit(fails ? 1 : 0);
