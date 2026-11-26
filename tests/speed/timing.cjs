// Speed check for Our Circle: the real app (not demo mode) against Firebase's local emulators, with a family-sized
// circle, on a phone-like connection (4G) and CPU. Prints timings and sizes only.
//
// How to run (from this folder; needs Java for the emulators and Playwright with Chromium):
//   1. npx firebase-tools emulators:start --only auth,firestore,storage --project demo-oc   (leave it running)
//   2. node seed.mjs                       (adds the test family; run from ../../functions so firebase-admin is found)
//   3. ./copy-app.sh site                  (a copy of the app pointed at the emulators)
//   4. npm pack firebase@10.12.2 && tar xzf firebase-10.12.2.tgz   (Firebase's code, served locally)
//   5. PKG=$PWD/package node timing.cjs site
const { chromium, devices } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const B = __dirname, root = path.join(B, process.argv[2] || 'site'), PKG = process.env.PKG;
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p === '/') p = '/index.html'; const f = path.join(root, p);
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(r); }).listen(0);
const RUNS = Number(process.env.RUNS || 5);
let fbHits = 0, fbBytes = 0;
const fbSrv = http.createServer((q, r) => { const f = path.join(PKG, path.basename(new URL(q.url, 'http://x').pathname)); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  const body = Buffer.from(fs.readFileSync(f, 'utf8').split('https://www.gstatic.com/firebasejs/').join('http://localhost:5077/firebasejs/')); fbHits++; fbBytes += body.length; r.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000' }); r.end(body); }).listen(5077);
const imgCount = (pg) => pg.evaluate(() => performance.getEntriesByType('resource').filter((e) => /firebasestorage/.test(e.name)).length);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], serviceWorkers: 'allow' });
  const pg = await ctx.newPage();
  const base = `http://localhost:${srv.address().port}/`;
  let bytes = { gstatic: 0, app: 0, db: 0, img: 0 }, imgN = 0;
  const cdp = await ctx.newCDPSession(pg);
  await cdp.send('Network.enable');
  cdp.on('Network.loadingFinished', (e) => {});
  const sizes = new Map();
  cdp.on('Network.responseReceived', (e) => sizes.set(e.requestId, e.response.url));
  cdp.on('Network.loadingFinished', (e) => { const u = sizes.get(e.requestId) || ''; if (/127\.0\.0\.1:8080|:9099/.test(u)) bytes.db += e.encodedDataLength; else if (u.startsWith(base)) bytes.app += e.encodedDataLength; });
  // Phone-like: 4G (70 ms, ~9 Mbps down) and a phone CPU (4× slower than this machine).
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 70, downloadThroughput: 1.1e6, uploadThroughput: 4e5 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // sign in once
  await pg.goto(base); await pg.waitForSelector('#email', { timeout: 60000 });
  await pg.fill('#email', 'spencer@test.dev'); await pg.fill('#pw', 'password1'); await pg.click('form button[type=submit]');
  await pg.waitForSelector('.fam-bub', { timeout: 90000 }); await pg.waitForTimeout(4000);
  const open = async (clearHttp) => {
    if (clearHttp) await cdp.send('Network.clearBrowserCache');
    bytes = { gstatic: 0, app: 0, db: 0, img: 0 }; imgN = 0; fbBytes = 0;
    const t0 = Date.now();
    await pg.goto(base + '?r=' + Math.random().toString(36).slice(2) + '#/family');
    await pg.waitForSelector('.fam-bub', { timeout: 90000 });
    const t = Date.now() - t0; await pg.waitForTimeout(1500);
    const marks = await pg.evaluate(() => window.__marks || {}); return { marks, ms: t, kb: Math.round((fbBytes + bytes.app + bytes.db) / 1024), fbKB: Math.round(fbBytes / 1024), dbKB: Math.round(bytes.db / 1024) };
  };
  const out = {};
  for (const [name, clear] of (process.env.SWAP ? [['open (phone dropped its web cache)', true], ['open (warm)', false]] : [['open (warm)', false], ['open (phone dropped its web cache)', true]])) {
    const runs = []; for (let i = 0; i < RUNS; i++) runs.push(await open(clear));
    out[name] = { median_ms: med(runs.map((r) => r.ms)), max_ms: Math.max(...runs.map((r) => r.ms)), kb: med(runs.map((r) => r.kb)), firebase_code_kb: med(runs.map((r) => r.fbKB)), db_kb: med(runs.map((r) => r.dbKB)), last_marks: runs.at(-1).marks };
  }
  // chats: open the family chat
  const chat = []; let msgs = 0;
  for (let i = 0; i < RUNS; i++) {
    await pg.goto(base + '#/chats'); await pg.waitForSelector('.chat-row'); await pg.waitForTimeout(500);
    const t0 = Date.now(); await pg.click('.chat-row[href="#/chat/everyone"]'); await pg.waitForSelector('#msgs .msg'); chat.push(Date.now() - t0);
    msgs = await pg.$$eval('#msgs .msg', (x) => x.length);
  }
  out['open the family chat'] = { median_ms: med(chat), max_ms: Math.max(...chat), messages_drawn: msgs };
  const al = []; let cards = 0, imgs = 0, dom = 0;
  for (let i = 0; i < RUNS; i++) {
    await pg.goto(base + '#/family'); await pg.waitForSelector('.fam-bub'); await pg.waitForTimeout(500); imgN = 0;
    const t0 = Date.now(); await pg.evaluate(() => { location.hash = '#/album'; }); await pg.waitForSelector('.album-card'); al.push(Date.now() - t0);
    await pg.waitForTimeout(1500); cards = await pg.$$eval('.album-card', (x) => x.length); imgs = await imgCount(pg); dom = await pg.evaluate(() => document.querySelectorAll('*').length);
  }
  out['open the album'] = { median_ms: med(al), max_ms: Math.max(...al), albums_drawn: cards, photos_downloaded: imgs, page_elements: dom };
  const one = []; let tiles = 0;
  for (let i = 0; i < RUNS; i++) {
    await pg.goto(base + '#/album'); await pg.waitForSelector('.album-card'); await pg.waitForTimeout(500); imgN = 0;
    const t0 = Date.now(); await pg.click('.album-card'); await pg.waitForSelector('.wall-item'); one.push(Date.now() - t0); await pg.waitForTimeout(1500); tiles = await imgCount(pg);
  }
  out['open one album'] = { median_ms: med(one), max_ms: Math.max(...one), photos_downloaded: tiles };
  console.log(JSON.stringify(out, null, 1));
  await b.close(); srv.close(); fbSrv.close();
})();
