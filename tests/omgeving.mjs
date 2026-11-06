// Controle: alleen het live adres mag de live database gebruiken.
// Draai met: node tests/omgeving.mjs   (leest alleen index.html, raakt geen database aan)
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FOUT'} ${msg}`); if (!cond) fails++; };

const LIVE_REF = 'udiqtseewsifcmxsrwtu';
const block = html.match(/const SB_ENVS = \{[\s\S]*?\nconst sbEnvFor = [^\n]+/);
ok(!!block, 'database-keuze (SB_ENVS / sbEnvFor) gevonden');
if (block) {
  const ctx = {};
  vm.runInNewContext(block[0] + '\nthis.SB_ENVS = SB_ENVS; this.SB_LIVE_HOSTS = SB_LIVE_HOSTS; this.sbEnvFor = sbEnvFor;', ctx);
  const { SB_ENVS, SB_LIVE_HOSTS, sbEnvFor } = ctx;
  const urlFor = host => SB_ENVS[sbEnvFor(host)].url;

  ok(JSON.stringify(SB_LIVE_HOSTS) === JSON.stringify(['masri-kids.vercel.app']), 'precies één live adres: masri-kids.vercel.app');
  ok(urlFor('masri-kids.vercel.app').includes(LIVE_REF), 'live adres → live database');

  const nietLive = [
    'masri-kids-l41tv10jm-suzettta-9928s-projects.vercel.app', // testversie
    'masri-kids-git-main-suzettta-9928s-projects.vercel.app',
    'masri-kids-suzettta-9928s-projects.vercel.app',
    'localhost', '127.0.0.1', '',                                // eigen computer / lokaal bestand
    'masri-kids.vercel.app.evil.com', 'xmasri-kids.vercel.app',   // lijkt erop, is het niet
    'MASRI-KIDS.VERCEL.APP.', 'onbekend.example',
  ];
  for (const h of nietLive) ok(!urlFor(h).includes(LIVE_REF), `"${h || '(leeg)'}" → NIET de live database`);

  ok(!SB_ENVS.test.url.includes(LIVE_REF) && !SB_ENVS.test.key.startsWith('sb_publishable_XZB277'),
    'testinstellingen bevatten geen live adres of live sleutel');
}

// De live database mag nergens anders in de app genoemd worden dan in SB_ENVS.live
const mentions = html.split(LIVE_REF).length - 1;
ok(mentions === 1, `live database-adres komt precies 1 keer voor in index.html (gevonden: ${mentions})`);

console.log(fails ? `\n${fails} controle(s) mislukt.` : '\nAlle omgevingscontroles geslaagd.');
process.exit(fails ? 1 : 0);
