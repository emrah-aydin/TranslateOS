// TranslateOS altyazı servisi (TV üzerinde, Node 20).
// Döngü: TV ekran görüntüsü (SSAP executeOneShot) → altyazı bandı değişti mi? → Gemini (oku + çevir) → uygulamaya bildir.
'use strict';
var Service = require('webos-service');
var fs = require('fs');
var path = require('path');
var https = require('https');
var WebSocket = require('ws');
var jpeg = require('jpeg-js');

var service = new Service('com.translateos.app.service');
process.on('uncaughtException', function (e) { try { log('ÇÖKME: ' + (e && e.stack || e)); } catch (x) {} });
process.on('unhandledRejection', function (e) { try { log('YAKALANMAYAN: ' + (e && e.stack || e)); } catch (x) {} });
var lastBeat = 0, loopStage = 'başlamadı';
var REGISTRATION = require('./registration.json');
var CONFIG = {};
try { CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8')); } catch (e) {}
var MODEL = CONFIG.model || 'gemini-3.5-flash-lite';
var KEY_FILE = '/tmp/translateos_app_client_key';

// Altyazı bölgesi (kare oranı). Türkçe kutumuz bunun ÜSTÜNDE durur, bu yüzden bu bölgeye girmez.
var EN_REGION = { x0: 0.12, x1: 0.88, y0: 0.865, y1: 1.0 };

var subscribers = [];
var running = false;
var stats = { frames: 0, calls: 0, cacheHits: 0, errors: 0 };

function emit(o) {
  subscribers = subscribers.filter(function (m) {
    try { m.respond(Object.assign({ returnValue: true }, o)); return true; } catch (e) { return false; }
  });
}
function log(s) {
  console.log('[translateos] ' + s); emit({ log: s });
  if (CONFIG.debugReceiver) {  // isteğe bağlı: geliştirme sırasında günlüğü bilgisayara gönder
    try {
      var hp = CONFIG.debugReceiver.split(':'), data = Buffer.from(JSON.stringify({ log: '[svc] ' + s }));
      var req = require('http').request({ host: hp[0], port: Number(hp[1] || 8790), path: '/log', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } });
      req.on('error', function () {}); req.end(data);
    } catch (e) {}
  }
}

function lunaCall(uri, params) {
  return new Promise(function (resolve) {
    service.call(uri, params, function (m) { resolve(m.payload); });
  });
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error(what + ' zaman aşımı')); }, ms); })]);
}

function httpsGetBuffer(uri) {
  return new Promise(function (resolve, reject) {
    var req = https.get(uri, { rejectUnauthorized: false }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve(Buffer.concat(chunks)); });
    });
    req.on('error', reject);
    req.setTimeout(5000, function () { req.destroy(new Error('indirme zaman aşımı')); });
  });
}

// --- TV'nin kendi SSAP'ı (localhost reddediliyor, TV'nin ağ adresi kullanılır) ---
function ssapConnect(url) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 8000 });
    var pending = {}, n = 0, registered = false, signed = true;
    var timer = setTimeout(function () { reject(new Error('eşleşme zaman aşımı')); try { ws.terminate(); } catch (e) {} }, 90000);
    function send(o) { ws.send(JSON.stringify(o)); }
    function register() {
      var key = null; try { key = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) {}
      var p = JSON.parse(JSON.stringify(REGISTRATION));
      if (!signed) {
        var m = p.manifest; delete m.signatures;
        var perms = {}; m.permissions.concat(m.signed.permissions).forEach(function (x) { perms[x] = 1; });
        m.permissions = Object.keys(perms).sort(); delete m.signed;
      }
      if (key) p['client-key'] = key;
      send({ type: 'register', id: 'reg0', payload: p });
    }
    ws.on('open', register);
    ws.on('error', function (e) { clearTimeout(timer); reject(e); });
    ws.on('close', function (c) {
      if (!registered) { clearTimeout(timer); reject(new Error('bağlantı kapandı ' + c)); }
      Object.keys(pending).forEach(function (id) { pending[id]({ error: 'closed' }); });
      pending = {};
      if (session && session.ws === ws) session = null;
    });
    ws.on('message', function (raw) {
      var m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
      if (m.id === 'reg0') {
        if (m.type === 'registered') {
          registered = true; clearTimeout(timer);
          try { fs.writeFileSync(KEY_FILE, m.payload['client-key']); } catch (e) {}
          resolve({
            ws: ws,
            request: function (uri, payload) {
              return new Promise(function (res2) {
                var id = 'r' + (n++); pending[id] = res2;
                send({ type: 'request', id: id, uri: uri, payload: payload || {} });
                setTimeout(function () { if (pending[id]) { delete pending[id]; res2({ error: 'timeout' }); } }, 8000);
              });
            }
          });
        } else if (m.type === 'error' && signed) { signed = false; register(); }
        else if (m.type === 'error') { clearTimeout(timer); reject(new Error('kayıt hatası: ' + JSON.stringify(m.error))); }
        else if (m.payload && m.payload.pairingType === 'PROMPT') { emit({ status: 'pairing' }); }
        return;
      }
      if (pending[m.id]) { var f = pending[m.id]; delete pending[m.id]; f(m.type === 'error' ? { error: m.error } : m.payload); }
    });
  });
}

var session = null;
async function getSession() {
  if (session) return session;
  var net = await lunaCall('luna://com.palm.connectionmanager/getStatus', {});
  var ips = [];
  ['wired', 'wifi'].forEach(function (k) { if (net && net[k] && net[k].ipAddress) ips.push(net[k].ipAddress); });
  if (!ips.length) throw new Error('TV ağ adresi bulunamadı');
  for (var i = 0; i < ips.length; i++) {
    try { session = await ssapConnect('wss://' + ips[i] + ':3001'); log('Ekran erişimi hazır'); emit({ status: 'ready' }); return session; }
    catch (e) { log('SSAP ' + ips[i] + ': ' + e.message); }
  }
  throw new Error('Ekran erişimi kurulamadı');
}

async function captureFrame() {
  var s = await getSession();
  var r = await s.request('ssap://tv/executeOneShot', { path: '/tmp/capture.jpg', method: 'DISPLAY', format: 'JPG' });
  if (!r || !r.imageUri) throw new Error('yakalama: ' + JSON.stringify(r).slice(0, 120));
  return httpsGetBuffer(r.imageUri);
}

// --- Bölge, imza, kırpma ---
function regionBox(img, R) {
  var x0 = Math.round(img.width * R.x0), x1 = Math.round(img.width * R.x1);
  var y0 = Math.round(img.height * R.y0), y1 = Math.round(img.height * R.y1);
  return { x0: x0, y0: y0, w: x1 - x0, h: y1 - y0 };
}
function lum(d, i) { return (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10; }
function isTextPixel(d, i, rowBytes) {
  var r = d[i], g = d[i + 1], b = d[i + 2];
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (!(mn > 175 && mx - mn < 45)) return false;
  // Altyazı harflerinin etrafında koyu gölge/çerçeve olur: 2 piksel çevrede koyu bir komşu ara.
  var o = [-8, 8, -2 * rowBytes, 2 * rowBytes, -8 + 2 * rowBytes, 8 - 2 * rowBytes];
  for (var k = 0; k < o.length; k++) { var j = i + o[k]; if (j >= 0 && j < d.length && lum(d, j) < 70) return true; }
  return false;
}
// Bölgeyi 64x8 hücreye böler, hücrelerdeki "beyaz yazı" piksel oranını döndürür.
function signature(img, box) {
  var GX = 64, GY = 8, cells = new Float32Array(GX * GY), total = 0, d = img.data;
  for (var y = 0; y < box.h; y++) {
    var gy = Math.min(GY - 1, (y * GY / box.h) | 0);
    for (var x = 0; x < box.w; x++) {
      var i = ((box.y0 + y) * img.width + box.x0 + x) * 4;
      if (isTextPixel(d, i, img.width * 4)) { cells[gy * GX + Math.min(GX - 1, (x * GX / box.w) | 0)]++; total++; }
    }
  }
  var per = (box.w / GX) * (box.h / GY);
  for (var k = 0; k < cells.length; k++) cells[k] /= per;
  return { cells: cells, density: total / (box.w * box.h) };
}
// Oransal fark: 0 = aynı yazı, 1 = tamamen farklı. Ölçüm (GTA V): aynı cümle ardışık karelerde 0,02–0,07;
// farklı cümleler 0,33–0,87.
function sigDiff(a, b) {
  if (!a || !b) return 1;
  var d = 0, s = 0;
  for (var i = 0; i < a.cells.length; i++) { d += Math.abs(a.cells[i] - b.cells[i]); s += a.cells[i] + b.cells[i]; }
  return s ? d / s : 0;
}
var CHANGED = 0.2, SAME = 0.12;
function sigKey(sig) {
  var s = ''; for (var i = 0; i < sig.cells.length; i++) s += String.fromCharCode(48 + Math.min(9, Math.round(sig.cells[i] * 20)));
  return s;
}
function cropJpeg(img, box) {
  var out = Buffer.alloc(box.w * box.h * 4);
  for (var y = 0; y < box.h; y++) {
    var start = ((box.y0 + y) * img.width + box.x0) * 4;
    out.set(img.data.subarray(start, start + box.w * 4), y * box.w * 4);
  }
  return jpeg.encode({ data: out, width: box.w, height: box.h }, 90).data;
}

// --- Gemini ---
var PROMPT = 'This is the bottom strip of a video game frame. If it contains an English dialogue subtitle (usually white, centered, ' +
  'possibly two lines), return it and a natural, fluent Turkish translation suitable for game subtitles (keep names; casual tone ' +
  'if the speaker is casual). Ignore HUD, minimap, phone screens, signs, license plates and any Turkish text. Reply only JSON: ' +
  '{"en": "...", "tr": "..."}. If there is no English subtitle, reply {"en": "", "tr": ""}.';

function geminiRequest(body, thinking) {
  var cfg = { responseMimeType: 'application/json', temperature: 0 };
  if (thinking === 'level') cfg.thinkingConfig = { thinkingLevel: 'minimal' };
  if (thinking === 'budget') cfg.thinkingConfig = { thinkingBudget: 0 };
  body.generationConfig = cfg;
  return fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CONFIG.geminiKey }, body: JSON.stringify(body)
  });
}
var thinkingMode = 'level';
async function readAndTranslate(jpg) {
  var body = { contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: Buffer.from(jpg).toString('base64') } }, { text: PROMPT }] }] };
  var res = await geminiRequest(body, thinkingMode);
  if (res.status === 400 && thinkingMode) { thinkingMode = thinkingMode === 'level' ? 'budget' : null; return readAndTranslate(jpg); }
  if (!res.ok) { var t = await res.text(); throw Object.assign(new Error('Gemini ' + res.status + ': ' + t.slice(0, 160)), { status: res.status }); }
  var j = await res.json();
  var text = j.candidates && j.candidates[0] && j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
  var o = JSON.parse(text);
  return { en: String(o.en || '').trim(), tr: String(o.tr || '').trim() };
}

// --- Ana döngü ---
// Görüntü sürekli alınır. Altyazı bölgesi değişince hemen Gemini'ye gider (sonucu beklemeden yakalama sürer).
// Daha yeni bir istek varken gelen eski sonuç gösterilmez. Gösterilen Türkçe, İngilizce kalkınca/değişince hemen kalkar.
var sigCache = [];    // [{sig, out}] — benzer görüntü → aynı sonuç (API'ye tekrar gitmez)
var cacheByEn = {};    // aynı İngilizce cümle → aynı çeviri
var reqSeq = 0, inFlight = 0;
async function loop() {
  if (running) return; running = true;
  if (!CONFIG.geminiKey) { log('Gemini anahtarı yok (config.local.json)'); emit({ status: 'nokey' }); }
  var lastSentSig = null, shownSig = null, shown = '', emptyFrames = 0, backoffUntil = 0, latestShownSeq = 0;
  function show(seq, sig, out, ms) {
    if (seq < latestShownSeq) return;            // daha yeni bir sonuç zaten gösterildi
    if (seq !== reqSeq) return;                  // bu arada ekrandaki yazı değişti; eski sonuç
    latestShownSeq = seq;
    if (out.tr) { shown = out.tr; shownSig = sig; emit({ en: out.en, tr: out.tr }); }
    else if (shown) { shown = ''; shownSig = null; emit({ clear: true }); }
    log((ms != null ? 'çeviri ' + ms + ' ms' : 'önbellek') + ': ' + (out.en || '(altyazı yok)'));
  }
  while (running) {
    var t0 = Date.now();
    try {
      if (Date.now() - lastBeat > 10000) { lastBeat = Date.now(); log('nabız: kare ' + stats.frames + ', istek ' + stats.calls + ', önbellek ' + stats.cacheHits + ', hata ' + stats.errors + ', bekleyen ' + inFlight); }
      loopStage = 'yakalama';
      var buf = await withTimeout(captureFrame(), 6000, 'yakalama'); stats.frames++;
      loopStage = 'çözme';
      var img = jpeg.decode(buf, { useTArray: true });
      var box = regionBox(img, EN_REGION);
      var sig = signature(img, box);
      var hasText = sig.density > 0.003;
      if (!hasText) {
        emptyFrames++;
        if (emptyFrames >= 2) {
          lastSentSig = null; reqSeq++;          // bekleyen istekler artık geçersiz
          if (shown) { shown = ''; shownSig = null; emit({ clear: true }); }
        }
      } else {
        emptyFrames = 0;
        if (sigDiff(sig, lastSentSig) > CHANGED) {   // yeni / farklı yazı
          if (shown && sigDiff(sig, shownSig) > CHANGED) { shown = ''; shownSig = null; emit({ clear: true }); }
          lastSentSig = sig;
          var seq = ++reqSeq, hit = null;
          for (var c = 0; c < sigCache.length; c++) if (sigDiff(sig, sigCache[c].sig) < SAME) { hit = sigCache[c].out; break; }
          if (hit) { stats.cacheHits++; show(seq, sig, hit, null); }
          else if (Date.now() > backoffUntil && CONFIG.geminiKey && inFlight < 3) {
            stats.calls++; inFlight++;
            (function (seq, sig, jpg, tc) {
              withTimeout(readAndTranslate(jpg), 8000, 'çeviri').then(function (out) {
                if (out.en && cacheByEn[out.en]) out.tr = cacheByEn[out.en];
                if (out.en) { cacheByEn[out.en] = out.tr; sigCache.unshift({ sig: sig, out: out }); if (sigCache.length > 300) sigCache.pop(); }
                show(seq, sig, out, Date.now() - tc);
              }).catch(function (e) {
                stats.errors++; log('çeviri hatası: ' + e.message);
                if (e.status === 429) backoffUntil = Date.now() + 15000;
                if (seq === reqSeq) lastSentSig = null;  // tekrar denensin
              }).then(function () { inFlight--; });
            })(seq, sig, cropJpeg(img, box), Date.now());
          }
        }
      }
    } catch (e) {
      stats.errors++;
      log('hata: ' + (e && e.message));
      await sleep(1000);
    }
    var wait = 150 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
}

var keepAlive = null;
service.register('start', function (message) {
  if (message.isSubscription) subscribers.push(message);
  log('start çağrıldı (abone: ' + subscribers.length + ', anahtar: ' + (CONFIG.geminiKey ? 'var' : 'YOK') + ', node ' + process.version + ')');
  if (!keepAlive) service.activityManager.create('translateos-keepalive', function (a) { keepAlive = a; });
  message.respond({ returnValue: true, status: 'started', model: MODEL });
  loop().catch(function (e) { log('döngü durdu: ' + e.message); running = false; });
}, function (message) {
  // abonelik iptal: kimse dinlemiyorsa durdur
  subscribers = subscribers.filter(function (m) { return m !== message; });
  log('abonelik iptal edildi (kalan: ' + subscribers.length + ')');
  if (!subscribers.length) {
    running = false;
    if (keepAlive) { service.activityManager.complete(keepAlive, function () {}); keepAlive = null; }
  }
});
service.register('stop', function (m) { running = false; m.respond({ returnValue: true }); });
service.register('stats', function (m) { m.respond(Object.assign({ returnValue: true, model: MODEL, stage: loopStage, running: running }, stats)); });
service.register('showInput', function (m) {
  // Uygulamadan çıkarken TV'nin kendi HDMI ekranına güvenli dönüş.
  var id = 'com.webos.app.hdmi' + ((m.payload && m.payload.port) || 1);
  lunaCall('luna://com.webos.applicationManager/launch', { id: id }).then(function (r) { m.respond(r || { returnValue: true }); });
});
module.exports = { _test: { regionBox: regionBox, signature: signature, sigDiff: sigDiff, EN_REGION: EN_REGION } };
