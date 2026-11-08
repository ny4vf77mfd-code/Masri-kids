// Opslagtest via de echte Storage-API (niet via SQL) voor "Proberen zonder account".
// Draait ALLEEN tegen het testproject. Weigert elk ander adres, ook het live-project.
//
// Gebruik (in een terminal; wachtwoorden worden nergens opgeslagen):
//   TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... TEST_GEZIN_EMAIL=... TEST_GEZIN_PASSWORD=... node tests/storage_api_test.mjs
// - TEST_ADMIN_*: een testaccount dat beheerder is in het testproject.
// - TEST_GEZIN_*: een gewoon testgezin (geen beheerder) in het testproject.
// Vereist: privé-bucket 'demo' (dashboard) en migratie 20261108_gast_demo.sql op het testproject.
//
// Betrouwbaarheid:
// - Elke run gebruikt unieke namen (RUN). De test raakt nooit bestaande bestanden of woorden aan,
//   en ruimt aan het eind ALLEEN op wat hij in deze run zelf heeft aangemaakt.
// - Een API-fout telt nooit als "geweigerd = veilig". Een weigering moet een verwachte weigering zijn
//   (status 400/401/403/404, of 200 met een lege lijst), en waar mogelijk controleert de beheerder
//   daarna dat er echt niets veranderd is (bestand bestaat nog / is niet ontstaan).
//   Onverwachte antwoorden (netwerkfout, 5xx, onleesbaar antwoord) tellen als FOUT.
// - "Gast ziet niets in media" wordt bewezen met eigen tijdelijke bestanden in media/shared en in een
//   gezinsmap. Eerst wordt vastgesteld dat die bestanden echt bestaan; pas dan telt "niet zichtbaar".
// - Opruimen wordt gecontroleerd. Lukt het niet, dan telt dat als mislukte test.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const TEST_REF = 'jiqzpxkrztjnpathtcvl';
const LIVE_REF = 'udiqtseewsifcmxsrwtu';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/test:\s*\{\s*url:'([^']+)',\s*key:'([^']+)'/);
if (!m) { console.error('Testinstellingen niet gevonden in index.html'); process.exit(2); }
const [, URL_, KEY] = m;
if (!URL_.includes(TEST_REF) || URL_.includes(LIVE_REF)) { console.error('Geweigerd: dit is niet het testproject.'); process.exit(2); }
const need = ['TEST_ADMIN_EMAIL', 'TEST_ADMIN_PASSWORD', 'TEST_GEZIN_EMAIL', 'TEST_GEZIN_PASSWORD'].filter(k => !process.env[k]);
if (need.length) { console.error('Ontbreekt: ' + need.join(', ')); process.exit(2); }

let fails = 0;
const ok = (cond, msg, extra = '') => { console.log(`${cond ? 'OK  ' : 'FOUT'} ${msg}${!cond && extra ? '  (' + extra + ')' : ''}`); if (!cond) fails++; };
const S = `${URL_}/storage/v1`, R = `${URL_}/rest/v1`;
const hdr = (token, extra = {}) => ({ apikey: KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra });

// Unieke namen voor deze run; alleen deze worden opgeruimd.
const RUN = 'rlstest_' + Date.now().toString(36) + '_' + randomBytes(3).toString('hex');
const made = { demo: new Set(), shared: new Set(), media: new Set(), content: new Set(), demo_words: new Set() };

// ---------- API-hulpjes: geven altijd {status, data} terug, nooit stil een lege lijst ----------
async function call(url, opts) {
  try {
    const r = await fetch(url, opts);
    const text = await r.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: r.status, data };
  } catch (e) { return { status: 0, data: String(e) }; }   // netwerkfout
}
const DENIED = s => [400, 401, 403, 404].includes(s);       // verwachte weigeringen van Storage/PostgREST
const UNEXPECTED = s => s === 0 || s >= 500;
const desc = res => `status ${res.status}`;

async function login(email, password) {
  const res = await call(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: hdr(null, { 'Content-Type': 'application/json' }), body: JSON.stringify({ email, password }) });
  if (res.status !== 200 || !res.data || !res.data.access_token) throw new Error(`inloggen mislukt (${res.status})`);
  return { token: res.data.access_token, uid: res.data.user && res.data.user.id };
}
const upload = (token, bucket, path, type, body, upsert = false) =>
  call(`${S}/object/${bucket}/${path}`, { method: 'POST', headers: hdr(token, { 'Content-Type': type, 'x-upsert': String(upsert) }), body });
const list = (token, bucket, prefix) =>
  call(`${S}/object/list/${bucket}`, { method: 'POST', headers: hdr(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix, limit: 1000, search: RUN }) });
const sign = (token, bucket, path) =>
  call(`${S}/object/sign/${bucket}/${path}`, { method: 'POST', headers: hdr(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: 60 }) });
const download = signed => call(`${S}${signed}`, { method: 'GET' });
const remove = (token, bucket, paths) =>
  call(`${S}/object/${bucket}`, { method: 'DELETE', headers: hdr(token, { 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes: paths }) });
const moveOrCopy = (token, kind, from, to) =>
  call(`${S}/object/${kind}`, { method: 'POST', headers: hdr(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ bucketId: from.bucket, sourceKey: from.path, destinationBucket: to.bucket, destinationKey: to.path }) });
const rest = (token, method, path, body) =>
  call(`${R}/${path}`, { method, headers: hdr(token, { 'Content-Type': 'application/json', Prefer: 'return=representation' }), body: body ? JSON.stringify(body) : undefined });

// Lijst lezen als iemand anders: geslaagd antwoord met namen, of null bij een fout.
const names = res => (res.status === 200 && Array.isArray(res.data)) ? res.data.map(f => f.name) : null;
// Bestaat een bestand? Gecontroleerd door de beheerder (die mag in demo lezen) of het gezin (eigen map).
async function exists(token, bucket, path) {
  const dir = path.split('/').slice(0, -1).join('/'), file = path.split('/').pop();
  const n = names(await list(token, bucket, dir));
  if (n === null) throw new Error(`kon ${bucket}/${dir} niet lezen om te controleren`);
  return n.includes(file);
}
// "Geweigerd" = een verwachte weigering. Een onverwacht antwoord is altijd FOUT.
const refused = res => DENIED(res.status);
// "Lijst toont het niet" = geslaagd antwoord zonder dat bestand, of een verwachte weigering.
const hidden = (res, file) => { if (UNEXPECTED(res.status)) return false; const n = names(res); return n ? !n.includes(file) : DENIED(res.status); };

const AUDIO = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const A = `audio/${RUN}.mp3`, P = `pics/${RUN}.png`, X = `geheim/${RUN}.png`;
const W_DEMO = `${RUN}_demo`, W_INTERN = `${RUN}_intern`;

const admin = await login(process.env.TEST_ADMIN_EMAIL, process.env.TEST_ADMIN_PASSWORD);
const gezin = await login(process.env.TEST_GEZIN_EMAIL, process.env.TEST_GEZIN_PASSWORD);
const OWN = `${gezin.uid}/audio/${RUN}_eigen.mp3`;
const SHARED = `shared/audio/${RUN}_gedeeld.mp3`;
console.log(`Testrun ${RUN} op het testproject\n`);
try {
  // ---------- beheerder ----------
  let res = await upload(admin.token, 'demo', A, 'audio/mpeg', AUDIO);
  ok(res.status === 200, 'beheerder uploadt demo/audio', desc(res)); if (res.status === 200) made.demo.add(A);
  res = await upload(admin.token, 'demo', P, 'image/png', PNG);
  ok(res.status === 200, 'beheerder uploadt demo/pics', desc(res)); if (res.status === 200) made.demo.add(P);
  res = await upload(admin.token, 'demo', X, 'image/png', PNG);
  if (res.status === 200) made.demo.add(X);
  ok(refused(res) && !(await exists(admin.token, 'demo', X).catch(() => false)), 'beheerder kan NIET uploaden buiten audio/ en pics/', desc(res));
  res = await upload(admin.token, 'demo', P, 'image/png', PNG, true);
  ok(res.status === 200, 'beheerder kan een demo-bestand overschrijven (wijzigen)', desc(res));
  ok(await exists(admin.token, 'demo', A), 'beheerder ziet demo-bestand');
  res = await rest(admin.token, 'POST', 'content', [
    { id: W_DEMO, data: { ar: 'x', ph: 'x', nl: 'x', note: 'GEHEIM', verified: true } },
    { id: W_INTERN, data: { ar: 'y', ph: 'y', nl: 'y', note: 'GEHEIM' } }]);
  ok(res.status === 201, 'beheerder zet testwoorden klaar', desc(res)); if (res.status === 201) { made.content.add(W_DEMO); made.content.add(W_INTERN); }
  res = await rest(admin.token, 'POST', 'demo_words', { id: W_DEMO });
  ok(res.status === 201, 'beheerder maakt een woord openbaar', desc(res)); if (res.status === 201) made.demo_words.add(W_DEMO);

  // ---------- eigen testbestanden in media (nodig om "gast ziet dit niet" echt te bewijzen) ----------
  res = await upload(admin.token, 'media', SHARED, 'audio/mpeg', AUDIO);
  ok(res.status === 200, 'beheerder zet een tijdelijk testbestand in media/shared (voorbereiding)', desc(res)); if (res.status === 200) made.shared.add(SHARED);
  ok(await exists(admin.token, 'media', SHARED), 'controle vooraf: het testbestand in media/shared bestaat echt');
  res = await upload(gezin.token, 'media', OWN, 'audio/mpeg', AUDIO);
  ok(res.status === 200, 'gezin kan een eigen bestand in media zetten (voorbereiding)', desc(res)); if (res.status === 200) made.media.add(OWN);
  ok(await exists(gezin.token, 'media', OWN), 'controle vooraf: het testbestand in de gezinsmap bestaat echt');

  // ---------- gast ----------
  for (const [path, label] of [[A, 'audio'], [P, 'pics']]) {
    const s = await sign(null, 'demo', path);
    const url = s.status === 200 && s.data && s.data.signedURL;
    const d = url ? await download(url) : { status: s.status };
    ok(!!url && d.status === 200, `gast kan demo/${label} lezen en downloaden`, `${desc(s)} / ${desc(d)}`);
  }
  res = await list(null, 'demo', 'audio');
  ok(names(res) !== null && names(res).includes(`${RUN}.mp3`), 'gast ziet demo-bestand in de lijst', desc(res));
  res = await sign(null, 'demo', X);
  ok(refused(res), 'gast krijgt geen downloadlink buiten audio/ en pics/', desc(res));
  for (const [path, label] of [[SHARED, 'media/shared'], [OWN, 'een gezinsmap in media']]) {
    const dir = path.split('/').slice(0, -1).join('/'), file = path.split('/').pop();
    const l = await list(null, 'media', dir);
    ok(hidden(l, file), `gast ziet het testbestand in ${label} NIET`, desc(l));
    const sg = await sign(null, 'media', path);
    ok(refused(sg), `gast krijgt geen downloadlink voor ${label}`, desc(sg));
  }
  res = await remove(null, 'media', [SHARED]);
  ok(!UNEXPECTED(res.status) && (DENIED(res.status) || (Array.isArray(res.data) && res.data.length === 0)) && await exists(admin.token, 'media', SHARED),
    'gast kan een bestand in media/shared NIET verwijderen (bestand bestaat nog)', desc(res));
  res = await moveOrCopy(null, 'copy', { bucket: 'media', path: SHARED }, { bucket: 'demo', path: `audio/${RUN}_uit_gedeeld.mp3` });
  if (res.status === 200) made.demo.add(`audio/${RUN}_uit_gedeeld.mp3`);
  ok(refused(res) && !(await exists(admin.token, 'demo', `audio/${RUN}_uit_gedeeld.mp3`)), 'gast kan een bestand NIET uit media/shared naar demo kopiëren', desc(res));
  res = await upload(null, 'demo', `audio/${RUN}_gast.mp3`, 'audio/mpeg', AUDIO);
  if (res.status === 200) made.demo.add(`audio/${RUN}_gast.mp3`);
  ok(refused(res) && !(await exists(admin.token, 'demo', `audio/${RUN}_gast.mp3`)), 'gast kan NIET uploaden in demo', desc(res));
  res = await upload(null, 'media', `shared/audio/${RUN}_gast.mp3`, 'audio/mpeg', AUDIO);
  if (res.status === 200) made.shared.add(`shared/audio/${RUN}_gast.mp3`);
  ok(refused(res) && !(await exists(admin.token, 'media', `shared/audio/${RUN}_gast.mp3`)), 'gast kan NIET uploaden in media', desc(res));
  res = await upload(null, 'demo', A, 'audio/mpeg', AUDIO, true);
  ok(refused(res), 'gast kan een demo-bestand NIET overschrijven', desc(res));
  res = await remove(null, 'demo', [A, P]);
  ok(!UNEXPECTED(res.status) && (DENIED(res.status) || (Array.isArray(res.data) && res.data.length === 0)) && await exists(admin.token, 'demo', A) && await exists(admin.token, 'demo', P),
    'gast kan demo-bestanden NIET verwijderen (bestanden bestaan nog)', desc(res));
  res = await moveOrCopy(null, 'move', { bucket: 'demo', path: A }, { bucket: 'demo', path: `audio/${RUN}_weg.mp3` });
  if (res.status === 200) made.demo.add(`audio/${RUN}_weg.mp3`);
  ok(refused(res) && await exists(admin.token, 'demo', A), 'gast kan NIET verplaatsen', desc(res));
  res = await moveOrCopy(null, 'copy', { bucket: 'demo', path: A }, { bucket: 'demo', path: `audio/${RUN}_kopie.mp3` });
  if (res.status === 200) made.demo.add(`audio/${RUN}_kopie.mp3`);
  ok(refused(res) && !(await exists(admin.token, 'demo', `audio/${RUN}_kopie.mp3`)), 'gast kan NIET kopiëren', desc(res));
  res = await rest(null, 'GET', 'content?select=id&limit=1');
  ok(DENIED(res.status), 'gast kan public.content NIET rechtstreeks lezen', desc(res));
  res = await rest(null, 'POST', 'rpc/demo_content', {});
  const dj = res.status === 200 && Array.isArray(res.data) ? res.data : null;
  ok(!!dj && dj.some(r => r.id === W_DEMO), 'gast krijgt het openbare woord via demo_content()', desc(res));
  ok(!!dj && !dj.some(r => r.id === W_INTERN), 'gast krijgt het interne woord NIET', desc(res));
  ok(!!dj && !dj.some(r => r.data && ('note' in r.data || 'verified' in r.data)), 'gast krijgt geen notitie of controle-vlag', desc(res));
  res = await rest(null, 'GET', 'demo_words?select=id');
  ok(DENIED(res.status), 'gast kan demo_words NIET lezen', desc(res));
  res = await rest(null, 'POST', 'demo_words', { id: `${RUN}_gast` });
  if (res.status === 201) made.demo_words.add(`${RUN}_gast`);
  ok(DENIED(res.status), 'gast kan geen woord openbaar maken', desc(res));

  // ---------- gewoon gezin ----------
  res = await list(gezin.token, 'demo', 'audio');
  ok(hidden(res, `${RUN}.mp3`), 'gezin ziet de demo-bestanden NIET', desc(res));
  res = await sign(gezin.token, 'demo', A);
  ok(refused(res), 'gezin krijgt GEEN downloadlink voor demo', desc(res));
  res = await upload(gezin.token, 'demo', `audio/${RUN}_gezin.mp3`, 'audio/mpeg', AUDIO);
  if (res.status === 200) made.demo.add(`audio/${RUN}_gezin.mp3`);
  ok(refused(res) && !(await exists(admin.token, 'demo', `audio/${RUN}_gezin.mp3`)), 'gezin kan NIET uploaden in demo', desc(res));
  res = await upload(gezin.token, 'demo', A, 'audio/mpeg', AUDIO, true);
  ok(refused(res), 'gezin kan een demo-bestand NIET overschrijven', desc(res));
  res = await remove(gezin.token, 'demo', [A, P]);
  ok(!UNEXPECTED(res.status) && (DENIED(res.status) || (Array.isArray(res.data) && res.data.length === 0)) && await exists(admin.token, 'demo', A) && await exists(admin.token, 'demo', P),
    'gezin kan demo-bestanden NIET verwijderen (bestanden bestaan nog)', desc(res));
  res = await moveOrCopy(gezin.token, 'move', { bucket: 'media', path: OWN }, { bucket: 'demo', path: `audio/${RUN}_verplaatst.mp3` });
  if (res.status === 200) made.demo.add(`audio/${RUN}_verplaatst.mp3`);
  ok(refused(res) && await exists(gezin.token, 'media', OWN) && !(await exists(admin.token, 'demo', `audio/${RUN}_verplaatst.mp3`)),
    'gezin kan eigen bestand NIET uit media naar demo verplaatsen', desc(res));
  res = await moveOrCopy(gezin.token, 'copy', { bucket: 'media', path: OWN }, { bucket: 'demo', path: `audio/${RUN}_gekopieerd.mp3` });
  if (res.status === 200) made.demo.add(`audio/${RUN}_gekopieerd.mp3`);
  ok(refused(res) && !(await exists(admin.token, 'demo', `audio/${RUN}_gekopieerd.mp3`)), 'gezin kan eigen bestand NIET uit media naar demo kopiëren', desc(res));
  res = await rest(gezin.token, 'POST', 'demo_words', { id: `${RUN}_gezin` });
  if (res.status === 201) made.demo_words.add(`${RUN}_gezin`);
  ok(DENIED(res.status), 'gezin kan geen woord openbaar maken', desc(res));

  // ---------- beheerder: niet-openbaar maken en verwijderen ----------
  res = await rest(admin.token, 'DELETE', `demo_words?id=eq.${W_DEMO}`);
  ok(res.status === 200 && Array.isArray(res.data) && res.data.length === 1, 'beheerder maakt het woord weer niet-openbaar', desc(res));
  if (res.status === 200) made.demo_words.delete(W_DEMO);
  res = await remove(admin.token, 'demo', [A, P]);
  ok(res.status === 200 && Array.isArray(res.data) && res.data.length === 2 && !(await exists(admin.token, 'demo', A)), 'beheerder kan demo-bestanden verwijderen', desc(res));
  if (res.status === 200) { made.demo.delete(A); made.demo.delete(P); }
} catch (e) {
  ok(false, 'test afgebroken door een onverwachte fout', e.message);
} finally {
  // Opruimen: ALLEEN wat deze run zelf heeft aangemaakt (allemaal met het unieke RUN-voorvoegsel).
  // Elk onderdeel wordt nagekeken; lukt het niet, dan telt dat als mislukte test.
  const own = s => [...s].filter(x => x.includes(RUN));
  const cleanFiles = async (label, token, bucket, paths) => {
    if (!paths.length) return;
    try {
      const r = await remove(token, bucket, paths);
      ok(r.status === 200, `opruimen: ${label} verwijderd`, desc(r));
      for (const p of paths) ok(!(await exists(token, bucket, p)), `opruimen gecontroleerd: ${p.split('/').pop()} is weg`);
    } catch (e) { ok(false, `opruimen van ${label} mislukt`, e.message); }
  };
  const cleanRows = async (table, ids) => {
    for (const id of ids) {
      try {
        const r = await rest(admin.token, 'DELETE', `${table}?id=eq.${id}`);
        const c = await rest(admin.token, 'GET', `${table}?select=id&id=eq.${id}`);
        ok(r.status === 200 && c.status === 200 && Array.isArray(c.data) && c.data.length === 0, `opruimen gecontroleerd: ${id} is weg uit ${table}`, `${desc(r)} / ${desc(c)}`);
      } catch (e) { ok(false, `opruimen van ${id} mislukt`, e.message); }
    }
  };
  await cleanFiles('demo-bestanden', admin.token, 'demo', own(made.demo));
  await cleanFiles('testbestanden in media/shared', admin.token, 'media', own(made.shared));
  await cleanFiles('testbestand in de gezinsmap', gezin.token, 'media', own(made.media));
  await cleanRows('demo_words', own(made.demo_words));
  await cleanRows('content', own(made.content));
}
console.log(fails ? `\n${fails} controle(s) mislukt.` : '\nAlle opslagcontroles via de API geslaagd.');
process.exit(fails ? 1 : 0);
