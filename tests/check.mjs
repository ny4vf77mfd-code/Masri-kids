// Automatische basiscontroles voor Masri Kids. Draai met: node tests/check.mjs
// Raakt geen database of gebruikersgegevens aan; leest alleen bestanden.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
