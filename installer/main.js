// TranslateOS kurulum programı
// Copyright (C) 2026 Emrah AYDIN. AGPL-3.0.
//
// Çift tıklayınca tarayıcıda bir kurulum sayfası açar. Sayfa ağdaki LG TV'leri bulur;
// kullanıcı TV'deki Developer Mode kodunu (Passphrase) girer, program TranslateOS'u TV'ye kurar ve açar.
// Komut satırından: TranslateOS-Kurulum --ip 192.168.x.x --code ABC123

'use strict';
const http = require('http');
const https = require('https');
const net = require('net');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Client, utils: sshUtils } = require('ssh2');

const APP_ID = 'com.translateos.app';
const REPO = 'emrah-aydin/TranslateOS';
const TV_TMP = '/media/developer/temp/translateos.ipk';
const LUNA = '/usr/bin/luna-send-pub';
const NET_HINT = process.platform === 'darwin'
  ? ' Mac\'te ayrıca: Sistem Ayarları › Gizlilik ve Güvenlik › Yerel Ağ bölümünde "TranslateOS Kurulum" açık olmalı.'
  : process.platform === 'win32' ? ' Windows güvenlik duvarı izin isterse "İzin ver"e bas.' : '';

// ---------- yardımcılar ----------
function httpGetBuf(url, { timeout = 8000, headers = {}, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(httpGetBuf(new URL(res.headers.location, url).toString(), { timeout, headers, redirects: redirects - 1 }));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(Object.assign(new Error('zaman aşımı'), { code: 'ETIMEDOUT' })));
  });
}

function portOpen(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(timeout, () => done(false));
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
  });
}

function isIp(s) { return net.isIPv4(String(s || '').trim()); }

// ---------- TV bulma (SSDP) ----------
function discover(ms = 3000) {
  return new Promise((resolve) => {
    const found = new Map();
    let sock;
    try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { return resolve([]); }
    const msg = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\n' +
      'ST: urn:lge-com:service:webos-second-screen:1\r\n\r\n');
    sock.on('message', (m, r) => {
      if (found.has(r.address)) return;
      const loc = (m.toString().match(/^location:\s*(\S+)/im) || [])[1];
      found.set(r.address, { ip: r.address, location: loc });
    });
    sock.on('error', () => {});
    sock.bind(() => {
      for (let i = 0; i < 3; i++) setTimeout(() => { try { sock.send(msg, 1900, '239.255.255.250'); } catch (e) {} }, i * 500);
    });
    setTimeout(async () => {
      try { sock.close(); } catch (e) {}
      const list = await Promise.all([...found.values()].map(async (tv) => {
        let name = 'LG TV';
        if (tv.location) {
          try {
            const xml = (await httpGetBuf(tv.location, { timeout: 2000 })).toString();
            const n = (xml.match(/<friendlyName>([^<]+)<\/friendlyName>/) || [])[1];
            if (n) name = n.replace(/&amp;/g, '&').trim();
          } catch (e) {}
        }
        return Object.assign({ ip: tv.ip, name }, await probe(tv.ip));
      }));
      resolve(list);
    }, ms);
  });
}

// Developer Mode açık mı (9922), Key Server açık mı (9991)?
async function probe(ip) {
  const [devMode, keyServer] = await Promise.all([portOpen(ip, 9922), portOpen(ip, 9991)]);
  return { devMode, keyServer };
}

// ---------- kurulum dosyası (.ipk) ----------
function embeddedIpk() {
  try {
    const sea = require('node:sea');
    if (sea.isSea()) return { buf: Buffer.from(sea.getAsset('app.ipk')), version: 'program içi' };
  } catch (e) {}
  const dir = path.join(__dirname, '..', 'dist', 'release');
  try {
    const f = fs.readdirSync(dir).filter((n) => n.endsWith('.ipk')).sort().pop();
    if (f) return { buf: fs.readFileSync(path.join(dir, f)), version: f };
  } catch (e) {}
  return null;
}

function looksLikeIpk(buf) { return buf && buf.length > 10000 && buf.slice(0, 8).toString('latin1') === '!<arch>\n'; }

// Önce GitHub'daki en son sürüm; olmazsa programın içindeki sürüm.
async function getIpk() {
  // Geliştirici: TRANSLATEOS_IPK=/yol/paket.ipk ile GitHub yerine yerel paket kurulur
  if (process.env.TRANSLATEOS_IPK) {
    const buf = fs.readFileSync(process.env.TRANSLATEOS_IPK);
    if (looksLikeIpk(buf)) return { buf, version: path.basename(process.env.TRANSLATEOS_IPK) };
  }
  try {
    const ua = { 'User-Agent': 'TranslateOS-Installer', Accept: 'application/vnd.github+json' };
    const rel = JSON.parse((await httpGetBuf(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: ua })).toString());
    const asset = (rel.assets || []).find((a) => /\.ipk$/.test(a.name));
    if (asset) {
      const buf = await httpGetBuf(asset.browser_download_url, { timeout: 30000, headers: { 'User-Agent': ua['User-Agent'] } });
      if (looksLikeIpk(buf)) return { buf, version: rel.tag_name };
    }
  } catch (e) {}
  const emb = embeddedIpk();
  if (emb && looksLikeIpk(emb.buf)) return emb;
  throw new Error('Kurulum dosyası indirilemedi. İnternet bağlantını kontrol edip tekrar dene.');
}

// ---------- SSH ----------
function sshConnect(ip, key, code) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c));
    c.on('error', reject);
    c.connect({ host: ip, port: 9922, username: 'prisoner', privateKey: key, passphrase: code, readyTimeout: 20000, keepaliveInterval: 5000 });
  });
}

function sshExec(conn, cmd, { onLine, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '', buf = '', finished = false;
      const finish = (e, v) => { if (finished) return; finished = true; clearTimeout(t); try { stream.close(); } catch (x) {} e ? reject(e) : resolve(v); };
      const t = setTimeout(() => finish(new Error('TV yanıt vermedi (zaman aşımı)')), timeout);
      stream.on('data', (d) => {
        out += d; buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (onLine && line) { const r = onLine(line); if (r) finish(r.error, r.value); }
        }
      });
      stream.stderr.on('data', (d) => { out += d; });
      stream.on('close', () => finish(null, out));
    });
  });
}

function sshUpload(conn, buf, remote) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (!err) {
        return sftp.writeFile(remote, buf, (e) => { sftp.end(); e ? streamUpload() : resolve(); });
      }
      streamUpload();
    });
    // SFTP yoksa: dosyayı "cat" ile gönder
    function streamUpload() {
      conn.exec(`cat > '${remote}'`, (err, stream) => {
        if (err) return reject(err);
        stream.on('close', (code) => (code === 0 || code == null ? resolve() : reject(new Error('dosya gönderilemedi'))));
        stream.stderr.on('data', () => {});
        stream.end(buf);
      });
    }
  });
}

// ---------- kurulum adımları ----------
const STEPS = [
  { id: 'file', label: 'Kurulum dosyası hazırlanıyor' },
  { id: 'connect', label: "TV'ye bağlanılıyor" },
  { id: 'upload', label: "TranslateOS TV'ye gönderiliyor" },
  { id: 'install', label: "TV'ye kuruluyor" },
  { id: 'launch', label: 'TranslateOS açılıyor' },
];

function friendlyError(e, ip) {
  const code = e && e.code;
  const msg = String((e && e.message) || e);
  if (e && e.friendly) return msg;
  if (/passphrase|decrypt|bad decrypt|parse privateKey/i.test(msg)) return "Kod yanlış. TV'deki Developer Mode uygulamasında yazan Passphrase'i (6 karakter) kontrol et.";
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ETIMEDOUT' || code === 'ENETUNREACH' || /Timed out|zaman aşımı/i.test(msg)) {
    return `TV'ye (${ip}) ulaşılamadı. TV açık mı, bilgisayar ile aynı Wi-Fi ağında mı? Developer Mode uygulamasında "Key Server" açık olmalı.`;
  }
  if (/All configured authentication methods failed/i.test(msg)) return "TV bağlantıyı kabul etmedi. Developer Mode uygulamasında Key Server'ı kapatıp açtıktan sonra tekrar dene.";
  return msg;
}

async function runInstall(ip, code, report) {
  ip = String(ip || '').trim();
  code = String(code || '').trim();
  if (!isIp(ip)) throw Object.assign(new Error("TV'nin IP adresi geçersiz (örnek: 192.168.1.50)."), { friendly: true });
  if (!/^[A-Za-z0-9]{6}$/.test(code)) throw Object.assign(new Error('Kod 6 karakter olmalı (harf ve rakam).'), { friendly: true });

  report('file', 'run');
  const ipk = await getIpk();
  report('file', 'ok', ipk.version);

  report('connect', 'run');
  if (!(await portOpen(ip, 9922, 3000))) {
    // 3001: her LG webOS TV'de açık olan uzaktan kumanda bağlantısı. Açıksa TV var ama Developer Mode kapalı.
    if (await portOpen(ip, 3001, 2000)) throw Object.assign(new Error(`Bu TV'de Developer Mode kapalı görünüyor (${ip}). Developer Mode uygulamasında "Dev Mode Status" ON olmalı.`), { friendly: true });
    throw Object.assign(new Error(`${ip} adresinde TV'ye ulaşılamadı. TV açık mı, bilgisayarla aynı Wi-Fi ağında mı? IP adresini Developer Mode uygulamasından kontrol et.` + NET_HINT), { friendly: true });
  }
  let keyPem;
  try { keyPem = (await httpGetBuf(`http://${ip}:9991/webos_rsa`, { timeout: 6000 })).toString(); }
  catch (e) { throw Object.assign(new Error(`TV'den bağlantı anahtarı alınamadı. Developer Mode uygulamasında "Key Server"ı ON yap ve tekrar dene.`), { friendly: true }); }
  // Kodu, bağlanmadan önce anahtarla doğrula (büyük harfle de dene)
  let pass = null;
  for (const c of [code, code.toUpperCase()]) {
    const k = sshUtils.parseKey(keyPem, c);
    if (!(k instanceof Error)) { pass = c; break; }
  }
  if (!pass) throw Object.assign(new Error("Kod yanlış. TV'deki Developer Mode uygulamasında yazan Passphrase'i (6 karakter) kontrol et."), { friendly: true });
  const conn = await sshConnect(ip, keyPem, pass);
  report('connect', 'ok');

  try {
    report('upload', 'run');
    await sshUpload(conn, ipk.buf, TV_TMP);
    report('upload', 'ok', Math.round(ipk.buf.length / 1024) + ' KB');

    report('install', 'run');
    const param = JSON.stringify({ id: APP_ID, ipkUrl: TV_TMP, subscribe: true });
    await sshExec(conn, `${LUNA} -i 'luna://com.webos.appInstallService/dev/install' '${param}'`, {
      timeout: 180000,
      onLine: (line) => {
        let o; try { o = JSON.parse(line.slice(line.indexOf('{'))); } catch (e) { return null; }
        const state = String((o.details && o.details.state) || '');
        if (o.returnValue === false) return { error: Object.assign(new Error('TV kurulumu reddetti: ' + (o.errorText || o.errorCode || 'bilinmeyen hata')), { friendly: true }) };
        if (/FAILED/i.test(state)) return { error: Object.assign(new Error('TV kurulumu reddetti: ' + ((o.details && o.details.reason) || state)), { friendly: true }) };
        if (/installed|^SUCCESS/i.test(state)) return { value: state };
        return null;
      },
    });
    report('install', 'ok');
    await sshExec(conn, `rm -f '${TV_TMP}'`, { timeout: 15000 }).catch(() => {});

    report('launch', 'run');
    await sshExec(conn, `${LUNA} -n 1 'luna://com.webos.applicationManager/launch' '${JSON.stringify({ id: APP_ID })}'`, { timeout: 20000 });
    report('launch', 'ok');
  } finally {
    conn.end();
  }
}

// ---------- tarayıcı arayüzü ----------
// Paketli programda esbuild sayfayı metin olarak gömer; geliştirirken dosyadan okunur.
function loadUi() {
  try { const h = require('./ui.html'); if (typeof h === 'string') return h; } catch (e) {}
  return fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');
}

function openBrowser(url) {
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }, () => {});
  else if (process.platform === 'darwin') execFile('open', [url], () => {});
  else execFile('xdg-open', [url], () => {});
}

function startUi() {
  const token = crypto.randomBytes(16).toString('hex');
  const html = loadUi();
  let job = null; // { steps, state: 'run'|'ok'|'error', error }
  let lastSeen = Date.now(), pageOpened = false;

  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || '');
    const port = server.address().port;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { res.writeHead(403); return res.end(); }
    const u = new URL(req.url, 'http://127.0.0.1');
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] !== token) { res.writeHead(404); return res.end('Bu adres geçersiz. Kurulum programını yeniden aç.'); }
    lastSeen = Date.now();
    const json = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
    const route = req.method + ' /' + (parts[1] || '');

    if (route === 'GET /') {
      pageOpened = true;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" });
      return res.end(html.replace('__TOKEN__', token).replace('__PLATFORM__', process.platform));
    }
    if (route === 'GET /scan') return discover().then((list) => json({ tvs: list }));
    if (route === 'GET /probe') {
      const ip = u.searchParams.get('ip');
      if (!isIp(ip)) return json({ error: 'IP geçersiz' }, 400);
      return probe(ip).then((p) => json(Object.assign({ ip, name: 'LG TV' }, p)));
    }
    if (route === 'GET /status') return json(job || { state: 'idle' });
    if (route === 'POST /quit') { json({ ok: true }); setTimeout(() => process.exit(0), 300); return; }
    if (route === 'POST /install') {
      if (job && job.state === 'run') return json({ error: 'Kurulum zaten sürüyor' }, 409);
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let p = {}; try { p = JSON.parse(body); } catch (e) {}
        job = { state: 'run', steps: STEPS.map((s) => ({ id: s.id, label: s.label, state: 'wait' })) };
        const report = (id, state, note) => { const s = job.steps.find((x) => x.id === id); s.state = state; if (note) s.note = note; };
        runInstall(p.ip, p.code, report)
          .then(() => { job.state = 'ok'; setTimeout(() => process.exit(0), 8000); })   // iş bitti: sayfa son durumu alsın, sonra kapan
          .catch((e) => {
            job.state = 'error'; job.error = friendlyError(e, p.ip);
            job.steps.forEach((s) => { if (s.state === 'run') s.state = 'error'; });
          });
        json({ ok: true });
      });
      return;
    }
    res.writeHead(404); res.end();
  });

  server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/${token}/`;
    console.log('');
    console.log('  TranslateOS Kurulum');
    console.log('  Kurulum sayfasi tarayicinda acildi. Acilmadiysa bu adresi tarayiciya yapistir:');
    console.log('  ' + url);
    console.log('  Kurulum bitince bu pencereyi kapatabilirsin.');
    console.log('');
    if (!process.env.TRANSLATEOS_NO_BROWSER) openBrowser(url);
  });

  // Sayfa kapandıktan bir süre sonra program kendiliğinden kapanır.
  setInterval(() => {
    const idle = Date.now() - lastSeen;
    if ((job && job.state === 'run') || idle < (pageOpened ? 60000 : 900000)) return;
    process.exit(0);
  }, 10000).unref();
}

// ---------- komut satırı ----------
function arg(name) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; }

if (arg('ip')) {
  const labels = Object.fromEntries(STEPS.map((s) => [s.id, s.label]));
  runInstall(arg('ip'), arg('code') || '', (id, state, note) => {
    if (state !== 'run') console.log((state === 'ok' ? '✓ ' : '✗ ') + labels[id] + (note ? ' (' + note + ')' : ''));
  })
    .then(() => { console.log('Kurulum tamam. TranslateOS TV\'de açıldı.'); process.exit(0); })
    .catch((e) => { console.error('Hata: ' + friendlyError(e, arg('ip'))); process.exit(1); });
} else if (process.argv.includes('--scan')) {
  discover().then((l) => { console.log(JSON.stringify(l, null, 2)); process.exit(0); });
} else {
  startUi();
}
