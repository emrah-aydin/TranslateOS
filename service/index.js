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
var MODEL = CONFIG.model || 'gemini-flash-lite-latest';  // TV'den ölçüm: 0,7–1,0 sn (kalıcı bağlantıyla)
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

// Geliştirme: kareyi bilgisayardaki alıcıya gönder (config.debugReceiver varsa).
var lastDebugPost = 0;
function debugFrame(buf, tag, force) {
  if (!CONFIG.debugReceiver || !CONFIG.debugFrames) return;
  if (!force && Date.now() - lastDebugPost < 1000) return;
  lastDebugPost = Date.now();
  try {
    var hp = CONFIG.debugReceiver.split(':');
    var req = require('http').request({ host: hp[0], port: Number(hp[1] || 8790), path: '/img?tag=' + encodeURIComponent(tag).slice(0, 80), method: 'POST',
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length } });
    req.on('error', function () {}); req.end(buf);
  } catch (e) {}
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

// --- Görüntü çözme: WebAssembly (mozjpeg) ~5 kat hızlı; yüklenemezse jpeg-js ---
var wasmDecode = null, decoderTried = false;
async function initDecoder() {
  if (decoderTried) return; decoderTried = true;
  try {
    var dir = path.join(__dirname, 'node_modules', '@jsquash', 'jpeg');
    var mod = await import('file://' + path.join(dir, 'decode.js'));
    await mod.init(await WebAssembly.compile(fs.readFileSync(path.join(dir, 'codec', 'dec', 'mozjpeg_dec.wasm'))));
    wasmDecode = mod.default;
    log('Hızlı görüntü çözücü hazır (WebAssembly)');
  } catch (e) { log('WebAssembly çözücü yüklenemedi, jpeg-js kullanılıyor: ' + e.message); }
}
async function decodeJpeg(buf) {
  if (wasmDecode) {
    var im = await wasmDecode(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
    return { data: im.data, width: im.width, height: im.height };
  }
  return jpeg.decode(buf, { useTArray: true });
}

// --- Bölge, imza, kırpma ---
// Türkçe kutu İngilizcenin ÜSTÜNE %90 koyulukla çizilir. Göze siyah görünür; ekran görüntüsünde altındaki İngilizce
// çok soluk kalır. Kutunun içindeki pikseller 10 kat parlatılarak İngilizce yine okunur, parlak Türkçe yazı yok sayılır.
var BOX_ALPHA = 0.9, BOX_GAIN = 1 / (1 - BOX_ALPHA), OWN_TEXT_LUM = 110;
function regionBox(img, R) {
  var x0 = Math.round(img.width * R.x0), x1 = Math.round(img.width * R.x1);
  var y0 = Math.round(img.height * R.y0), y1 = Math.round(img.height * R.y1);
  return { x0: x0, y0: y0, w: x1 - x0, h: y1 - y0 };
}
function lum(d, i) { return (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10; }
function neighborOffsets(rowBytes) { return [-8, 8, -2 * rowBytes, 2 * rowBytes, -8 + 2 * rowBytes, 8 - 2 * rowBytes]; }
function farOffsets(rowBytes) {
  var o = [];
  for (var dy = -3; dy <= 3; dy += 1) for (var dx = -3; dx <= 3; dx += 1) if (dx || dy) o.push(dy * rowBytes + dx * 4);
  return o;
}
// Kutu dışında: beyaz, renksiz ve yakınında belirgin koyu kenar (altyazı gölgesi) olan piksel.
function isTextPixel(d, i, off) {
  var r = d[i], g = d[i + 1], b = d[i + 2];
  var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (!(mn > 175 && mx - mn < 45)) return false;
  var L = lum(d, i);
  for (var k = 0; k < off.length; k++) { var j = i + off[k]; if (j >= 0 && j < d.length && lum(d, j) < L - 115) return true; }
  return false;
}
// Kutu içinde: parlak piksel bizim Türkçe yazımızdır (yok say); soluk olanlar 10 kat parlatılıp aynı ölçüye vurulur.
function isTextPixelShaded(d, i, off, far) {
  var L = lum(d, i);
  if (L > OWN_TEXT_LUM) return false;
  // Bizim Türkçe harflerin kenar yumuşatması da soluk görünür: parlak bir pikselin 3 px yakınındaysa İngilizce sayma.
  for (var q = 0; q < far.length; q++) { var jj = i + far[q]; if (jj >= 0 && jj < d.length && lum(d, jj) > OWN_TEXT_LUM * 0.8) return false; }
  var A = L * BOX_GAIN;
  if (A < 175) return false;
  for (var k = 0; k < off.length; k++) {
    var j = i + off[k];
    if (j >= 0 && j < d.length) { var Lj = lum(d, j); if (Lj <= OWN_TEXT_LUM && Lj * BOX_GAIN < A - 115) return true; }
  }
  return false;
}
function shadePx(img, sh) {
  if (!sh) return null;
  var alpha = sh.alpha || BOX_ALPHA;
  return { x0: Math.floor(sh.x0 * img.width), y0: Math.floor(sh.y0 * img.height), x1: Math.ceil(sh.x1 * img.width), y1: Math.ceil(sh.y1 * img.height),
    gain: 1 / (1 - alpha), ownText: sh.hasText !== false, ownThr: Math.max(OWN_TEXT_LUM * 0.8, 255 * (1 - alpha) + 70) };
}
// Bölgeyi 64x8 hücreye böler, hücrelerdeki yazı piksel oranını ve yazının kapladığı alanı (bbox) döndürür.
// Kutu varken ve yokken AYNI ölçü çıksın diye: kutu altındaki pikseller önce normal parlaklığına geri getirilir
// (x10), bizim Türkçe harfler ve 3 px çevresi "bilinmiyor" sayılır; sonra tüm bölgeye tek kural uygulanır.
function signature(img, box, sh) {
  var GX = 64, GY = 8, cells = new Float32Array(GX * GY), total = 0, d = img.data;
  var W = box.w, Hh = box.h, N = W * Hh, sp = shadePx(img, sh);
  var L = new Float32Array(N), C = new Float32Array(N);   // L: parlaklık (-1 = bilinmiyor), C: renklilik
  var own = sp ? new Uint8Array(N) : null;
  for (var y = 0; y < Hh; y++) {
    var py = box.y0 + y;
    for (var x = 0; x < W; x++) {
      var px = box.x0 + x, i = (py * img.width + px) * 4, k = y * W + x;
      var r = d[i], g = d[i + 1], bb = d[i + 2], l = (r * 3 + g * 6 + bb) / 10;
      var c = Math.max(r, g, bb) - Math.min(r, g, bb);
      if (sp && px >= sp.x0 && px < sp.x1 && py >= sp.y0 && py < sp.y1) {
        if (sp.ownText && l > sp.ownThr) { own[k] = 1; L[k] = -1; continue; }
        l *= sp.gain; c *= sp.gain;
      }
      L[k] = l; C[k] = c;
    }
  }
  if (own) {   // Türkçe harflerin 3 px çevresi de bilinmiyor
    var mark = new Uint8Array(N);
    for (k = 0; k < N; k++) if (own[k]) {
      var oy = (k / W) | 0, ox = k - oy * W;
      for (var dy = -3; dy <= 3; dy++) for (var dx = -3; dx <= 3; dx++) {
        var yy = oy + dy, xx = ox + dx; if (yy >= 0 && yy < Hh && xx >= 0 && xx < W) mark[yy * W + xx] = 1;
      }
    }
    for (k = 0; k < N; k++) if (mark[k]) L[k] = -1;
  }
  // Hücre bazında "bilinmiyor" oranı: Türkçe harflerin kapattığı hücreler karşılaştırmaya girmez.
  var unk = new Float32Array(GX * GY);
  for (y = 0; y < Hh; y++) { var gyu = Math.min(GY - 1, (y * GY / Hh) | 0); for (x = 0; x < W; x++) if (L[y * W + x] < 0) unk[gyu * GX + Math.min(GX - 1, (x * GX / W) | 0)]++; }
  var cols = new Uint16Array(W), xs = [], ys = [];
  // İnce çizgi testi: altyazı harfleri 1–4 px kalınlığında, İKİ yanında koyu gölge olan çizgilerdir.
  // Güneşli kaldırım, beton, gökyüzü gibi geniş açık alanlar ve tek taraflı kenarlar sayılmaz.
  function darkAt(xx, yy, ref) { if (xx < 0 || xx >= W || yy < 0 || yy >= Hh) return false; var q = L[yy * W + xx]; return q >= 0 && q < ref - 100; }
  for (y = 0; y < Hh; y++) {
    var gy = Math.min(GY - 1, (y * GY / Hh) | 0);
    for (x = 0; x < W; x++) {
      k = y * W + x; var lv = L[k];
      if (lv < 175 || C[k] > 60) continue;              // beyaz ve renksiz değil
      var lD = false, rD = false, uD = false, dD = false;
      for (var t = 1; t <= 4; t++) {
        if (!lD && darkAt(x - t, y, lv)) lD = true;
        if (!rD && darkAt(x + t, y, lv)) rD = true;
        if (!uD && darkAt(x, y - t, lv)) uD = true;
        if (!dD && darkAt(x, y + t, lv)) dD = true;
      }
      if (!((lD && rD) || (uD && dD))) continue;
      cells[gy * GX + Math.min(GX - 1, (x * GX / W) | 0)]++; total++; cols[x]++;
      if (xs.length < 20000) { xs.push(x); ys.push(y); }
    }
  }
  var per = (W / GX) * (Hh / GY);
  var hidden = new Uint8Array(GX * GY);
  for (k = 0; k < cells.length; k++) { cells[k] /= per; hidden[k] = unk[k] / per > 0.3 ? 1 : 0; }
  // Yazı alanı: sütunları kümelere ayır (kelime araları birleşir, mini harita gibi uzak parçalar ayrılır),
  // ortaya en yakın / en dolu kümeyi seç, sonra sadece o kümedeki satırlara bak.
  var gapMax = Math.round(img.width * 0.03), runs = [], cur = null, lastX = -1e9;
  for (x = 0; x < W; x++) {
    if (cols[x] < 2) continue;
    if (cur && x - lastX <= gapMax) { cur.x1 = x; cur.n += cols[x]; }
    else { cur = { x0: x, x1: x, n: cols[x] }; runs.push(cur); }
    lastX = x;
  }
  var mid = W / 2, best = null, bestScore = -1;
  runs.forEach(function (rn) {
    var dist = rn.x0 <= mid && rn.x1 >= mid ? 0 : Math.min(Math.abs(rn.x0 - mid), Math.abs(rn.x1 - mid));
    var score = rn.n / (1 + dist / (W * 0.1));
    if (score > bestScore) { bestScore = score; best = rn; }
  });
  var bbox = null;
  if (best) {
    var rowsIn = new Uint16Array(Hh);
    for (k = 0; k < xs.length; k++) if (xs[k] >= best.x0 && xs[k] <= best.x1) rowsIn[ys[k]]++;
    var r0 = -1, r1 = -1;
    for (y = 0; y < Hh; y++) if (rowsIn[y] >= 3) { if (r0 < 0) r0 = y; r1 = y; }
    var inBox = 0;
    for (k = 0; k < xs.length; k++) if (xs[k] >= best.x0 && xs[k] <= best.x1 && ys[k] >= r0 && ys[k] <= r1) inBox++;
    if (r0 >= 0) bbox = {
      x0: (box.x0 + best.x0) / img.width, x1: (box.x0 + best.x1 + 1) / img.width,
      y0: (box.y0 + r0) / img.height, y1: (box.y0 + r1 + 1) / img.height,
      fill: inBox / ((best.x1 - best.x0 + 1) * (r1 - r0 + 1)), share: total ? inBox / total : 0
    };
  }
  return { cells: cells, hidden: hidden, density: total / N, bbox: bbox };
}
// Oransal fark: 0 = aynı yazı, 1 = tamamen farklı. Ölçüm (GTA V): aynı cümle ardışık karelerde 0,02–0,07;
// farklı cümleler 0,33–0,87.
function sigDiff(a, b) {
  if (!a || !b) return 1;
  var d = 0, s = 0;
  for (var i = 0; i < a.cells.length; i++) {
    if ((a.hidden && a.hidden[i]) || (b.hidden && b.hidden[i])) continue;   // Türkçe harfin örttüğü hücre
    d += Math.abs(a.cells[i] - b.cells[i]); s += a.cells[i] + b.cells[i];
  }
  return s ? d / s : 0;
}
var CHANGED = 0.2, SAME = 0.12, STILL_SAME = 0.35;
// Kutuyu önceden açmak için yeterince "altyazı gibi" mi: yoğun, ortalanmış, satır yüksekliğinde.
function looksLikeSubtitle(sig) {
  var b = sig.bbox; if (!b || sig.density < 0.004) return false;
  var h = (b.y1 - b.y0) * 540, w = (b.x1 - b.x0) * 960, cx = (b.x0 + b.x1) / 2;
  return h >= 8 && h <= 48 && w >= 50 && w / h >= 3 && Math.abs(cx - 0.5) < 0.15 &&
    b.fill >= 0.06 && b.fill <= 0.6 && b.share >= 0.6;      // yazının çoğu tek bir ortalanmış satır bloğunda
}
// Gemini'ye giden kırpım: kutu içi parlatılır, bizim Türkçe yazı silinir; böylece model alttaki İngilizceyi okur.
function cropForGemini(img, box, sh) {
  var out = Buffer.alloc(box.w * box.h * 4), d = img.data, sp = shadePx(img, sh);
  for (var y = 0; y < box.h; y++) {
    var py = box.y0 + y;
    for (var x = 0; x < box.w; x++) {
      var px = box.x0 + x, i = (py * img.width + px) * 4, o = (y * box.w + x) * 4;
      if (sp && px >= sp.x0 && px < sp.x1 && py >= sp.y0 && py < sp.y1) {
        if (sp.ownText && lum(d, i) > sp.ownThr) { out[o] = out[o + 1] = out[o + 2] = 0; }
        else { out[o] = Math.min(255, d[i] * sp.gain); out[o + 1] = Math.min(255, d[i + 1] * sp.gain); out[o + 2] = Math.min(255, d[i + 2] * sp.gain); }
      } else { out[o] = d[i]; out[o + 1] = d[i + 1]; out[o + 2] = d[i + 2]; }
      out[o + 3] = 255;
    }
  }
  return jpeg.encode({ data: out, width: box.w, height: box.h }, 90).data;
}

// --- Gemini ---
var PROMPT = 'This is the bottom strip of a video game frame. If it contains an English dialogue subtitle (usually white, centered, ' +
  'possibly two lines), return the exact English text and its Turkish translation. ' +
  'Rules: translate ONLY into Turkish, never into any other language. Do not censor, soften, skip or summarize anything: ' +
  'profanity, slurs, insults and slang must be translated faithfully with equally strong natural Turkish street language. ' +
  'Keep names and places as they are. Make it sound like natural spoken Turkish game subtitles. ' +
  'A dialogue subtitle is a spoken sentence, not a single name. Ignore HUD, minimap, location or street names, mission titles, ' +
  'phone screens, signs, license plates and any Turkish text. Part of the subtitle may be faint because it sits behind a ' +
  'semi-transparent box; read it carefully. If the text is unreadable, garbled or not real English words, return empty strings ' +
  'instead of guessing. Reply only JSON: {"en": "...", "tr": "..."}. If there is no English subtitle, reply {"en": "", "tr": ""}.';

// Oyun diyalogları (küfür, şiddet) çeviride engellenmesin.
var SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT']
  .map(function (c) { return { category: c, threshold: 'BLOCK_NONE' }; });

// Okunan metin gerçekten İngilizce mi? (Kutu altından bozuk okuma "Eisdeforal" gibi anlamsız çıkabiliyor.)
var COMMON = ('the a an and or but to of in on at for with you your yours i me my mine we us our he him his she her they them ' +
  'their it its is are was were be been being am do does did done have has had not no yes this that these those what who ' +
  'why how where when there here come go get got gonna wanna just like man homie bro dude ok okay right now all out up down ' +
  'off back can could will would should shall may might must let lets so if then than too very really know think want need ' +
  'see look said say tell told take make made give put keep stop run shit fuck fucking damn hell ass bitch nigga motherfucker ' +
  'hey hi hello oh yeah well hold on over from into about some any one two more much good bad big little ain\'t don\'t i\'m ' +
  'it\'s that\'s you\'re we\'re they\'re can\'t won\'t didn\'t isn\'t wasn\'t i\'ll you\'ll we\'ll gotta').split(' ');
var COMMON_SET = {}; COMMON.forEach(function (w) { COMMON_SET[w] = 1; });
COMMON.concat(('get got go going gone come came take took make made know knew think thought see saw look want need like love ' +
  'give gave tell told say said call called work help talk walk drive car money time day night guy guys man men woman people ' +
  'friend family home house place way thing things life world job deal fine sure wait please thanks sorry fuck mad crazy ' +
  'dead kill killed shoot gun cops police boss kid kids son mother father brother sister wife name new old little long ' +
  'first last next ever never always still again only even also because about after before around through while until').split(' '))
  .forEach(function (w) { COMMON_SET[w] = 1; });
function looksEnglish(t) {
  var words = String(t).toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean)
    .map(function (w) { return w.replace(/('(ve|re|ll|s|d|m|t)|n't|in')$/, '').replace(/'/g, ''); });
  if (!words.length) return false;
  var common = words.filter(function (w) { return COMMON_SET[w]; }).length;
  var weird = words.filter(function (w) { return w.length > 3 && !/[aeiouy]/.test(w); }).length;
  if (weird / words.length > 0.25) return false;
  if (words.length <= 2) return common >= 1 || /[!?.]$/.test(String(t).trim());
  return common / words.length >= 0.2;
}
function looksTurkish(t, en) {
  t = String(t).trim(); if (!t) return false;
  if (normEn(t) === normEn(en)) return false;                    // çevrilmemiş
  return true;
}

// Kalıcı bağlantı: her istekte yeniden TLS el sıkışması yapılmasın (TV işlemcisinde pahalı).
var geminiAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 10000, maxSockets: 4 });
function httpsJson(method, pathName, body) {
  return new Promise(function (resolve, reject) {
    var data = body ? Buffer.from(JSON.stringify(body)) : null;
    var req = https.request({ host: 'generativelanguage.googleapis.com', path: pathName, method: method, agent: geminiAgent,
      headers: Object.assign({ 'x-goog-api-key': CONFIG.geminiKey }, data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}) },
      function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () { resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8'), reused: req.reusedSocket }); });
      });
    req.on('error', reject);
    req.setTimeout(8000, function () { req.destroy(new Error('Gemini zaman aşımı')); });
    if (data) req.write(data);
    req.end();
  });
}
function geminiRequest(body, thinking, model) {
  var cfg = { responseMimeType: 'application/json', temperature: 0 };
  body.safetySettings = SAFETY;
  if (thinking === 'level') cfg.thinkingConfig = { thinkingLevel: 'minimal' };
  if (thinking === 'budget') cfg.thinkingConfig = { thinkingBudget: 0 };
  body.generationConfig = cfg;
  return httpsJson('POST', '/v1beta/models/' + (model || MODEL) + ':generateContent', body);
}
var thinkingMode = {};
var prevEn = '';
async function readAndTranslate(jpg, model) {
  model = model || MODEL;
  var tm = thinkingMode[model] === undefined ? 'level' : thinkingMode[model];
  var prompt = PROMPT + (prevEn ? ' Previous subtitle line (context only, do not repeat it unless it is still shown): "' + prevEn + '"' : '');
  var body = { contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: Buffer.from(jpg).toString('base64') } }, { text: prompt }] }] };
  var t0 = Date.now();
  var res = await geminiRequest(body, tm, model);
  if (res.status === 400 && tm) { thinkingMode[model] = tm === 'level' ? 'budget' : null; return readAndTranslate(jpg, model); }
  if (res.status !== 200) throw Object.assign(new Error('Gemini ' + res.status + ': ' + res.text.slice(0, 160)), { status: res.status });
  var j = JSON.parse(res.text);
  var text = j.candidates && j.candidates[0] && j.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
  var o = JSON.parse(text || '{}');
  var en = String(o.en || '').trim(), tr = String(o.tr || '').trim(), rejected = '';
  if (en && !looksEnglish(en)) { rejected = 'anlamsız okuma: ' + en; en = ''; tr = ''; }
  else if (en && !looksTurkish(tr, en)) { rejected = 'çeviri geçersiz: ' + tr; en = ''; tr = ''; }
  return { en: en, tr: tr, ms: Date.now() - t0, reused: !!res.reused, rejected: rejected };
}
// Bağlantıyı sıcak tut: boşta kalınca ücretsiz bir model bilgisi isteği.
var lastGemini = 0;
setInterval(function () {
  if (!running || !CONFIG.geminiKey || Date.now() - lastGemini < 8000) return;
  lastGemini = Date.now();
  httpsJson('GET', '/v1beta/models/' + MODEL).catch(function () {});
}, 4000);

// Kıyas: config.bench = ["model1", ...] ise açılışta örnek kareyle her modeli 3 kez dener.
async function bench() {
  var sample; try { sample = fs.readFileSync(path.join(__dirname, 'bench.jpg')); } catch (e) { return; }
  var models = CONFIG.bench || [];
  for (var i = 0; i < models.length; i++) {
    var times = [], last = null;
    for (var k = 0; k < 3; k++) {
      try { var r = await readAndTranslate(sample, models[i]); times.push(r.ms + (r.reused ? '' : '*')); last = r.tr; }
      catch (e) { times.push('HATA ' + e.message.slice(0, 60)); }
    }
    log('KIYAS ' + models[i] + ': ' + times.join(' / ') + ' ms  → ' + last);
  }
}

// --- Ana döngü ---
// Görüntü sürekli alınır. Altyazı bölgesi değişince hemen Gemini'ye gider (sonucu beklemeden yakalama sürer).
// Daha yeni bir istek varken gelen eski sonuç gösterilmez. Gösterilen Türkçe, İngilizce kalkınca/değişince hemen kalkar.
var sigCache = [];    // [{sig, out}] — benzer görüntü → aynı sonuç (API'ye tekrar gitmez)
var cacheByEn = {};    // aynı İngilizce cümle → aynı çeviri (kalıcı: memory.json)

// --- Kalıcı cümle hafızası ---
// Her çevrilen cümle diske yazılır; uygulama yeniden açılınca yüklenir. İleride topluluk çeviri paketlerinin temeli.
var MEMORY_FILE = null;
function normEn(t) { return String(t).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
(function loadMemory() {
  var candidates = [path.join(__dirname, 'memory.json'), '/media/developer/temp/translateos-memory.json', '/tmp/translateos-memory.json'];
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i])) { var m = JSON.parse(fs.readFileSync(candidates[i], 'utf8')); Object.keys(m).forEach(function (k) { cacheByEn[k] = m[k]; }); }
      fs.writeFileSync(candidates[i] + '.yaz', 'ok'); fs.unlinkSync(candidates[i] + '.yaz');
      MEMORY_FILE = candidates[i]; break;
    } catch (e) {}
  }
})();
var memoryDirty = false;
function remember(en, tr) {
  var k = normEn(en); if (!k || !tr) return;
  if (cacheByEn[k] === tr) return;
  cacheByEn[k] = tr; memoryDirty = true;
}
setInterval(function () {
  if (!memoryDirty || !MEMORY_FILE) return;
  memoryDirty = false;
  fs.writeFile(MEMORY_FILE, JSON.stringify(cacheByEn), function (e) { if (e) log('hafıza yazılamadı: ' + e.message); });
}, 5000);
var reqSeq = 0, inFlight = 0, lastTiming = '';
var shade = null, rebase = false, peekAckAt = 0;   // ekrandaki Türkçe kutunun yeri (kare oranı) — uygulama bildirir

// Yakalama: iki istek üst üste (TV her biri için ~340 ms harcıyor); en son kare işlenir.
var latest = null, frameSignal = null;
function waitFrame() { return new Promise(function (r) { frameSignal = r; }); }
async function captureWorker(delay) {
  await sleep(delay);
  while (running) {
    try {
      var t = Date.now();
      var buf = await withTimeout(captureFrame(), 6000, 'yakalama'); stats.frames++;
      latest = { buf: buf, capMs: Date.now() - t, startedAt: t };
      if (frameSignal) { var f = frameSignal; frameSignal = null; f(); }
    } catch (e) { stats.errors++; log('yakalama hatası: ' + (e && e.message)); await sleep(1000); }
  }
}

async function loop() {
  if (running) return; running = true;
  if (!CONFIG.geminiKey) { log('Gemini anahtarı yok (config.local.json)'); emit({ status: 'nokey' }); }
  await initDecoder();
  if (CONFIG.bench && CONFIG.bench.length) { try { await bench(); } catch (e) { log('kıyas hatası: ' + e.message); } }
  captureWorker(0); captureWorker(170);
  var lastSentSig = null, lastReqSig = null, shownSig = null, shown = '', emptyFrames = 0, backoffUntil = 0;
  var boxOpen = false, pendingSince = 0, boxBbox = null, peekSince = 0, minUntil = 0;
  // Okuma süresi: Türkçe, İngilizce erken kalksa bile en az bu kadar ekranda kalır (yeni cümle gelirse onun yerine geçer).
  function readTime(tr) { return Math.max(2500, Math.min(7000, 1800 + String(tr).length * 55)); }
  function union(a, b) { if (!a) return b; if (!b) return a; return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }; }
  function openBox(msg) { boxOpen = true; if (msg.bbox) boxBbox = union(boxBbox, msg.bbox), msg.bbox = boxBbox; emit(msg); }
  function closeBox() { peekSince = 0; if (boxOpen) { boxOpen = false; shown = ''; shownSig = null; pendingSince = 0; boxBbox = null; emit({ clear: true }); } }
  // İngilizce, kutunun örttüğü alandan taştıysa (ör. ikinci satır geldi) kutuyu büyüt.
  function growBox(b) {
    if (!boxOpen || !b || !boxBbox) return;
    var m = 0.004;
    if (b.x0 < boxBbox.x0 - m || b.x1 > boxBbox.x1 + m || b.y0 < boxBbox.y0 - m || b.y1 > boxBbox.y1 + m) {
      boxBbox = union(boxBbox, b); emit({ bbox: boxBbox });
    }
  }
  function show(seq, sig, out, ms, bbox) {
    // Daha yeni bir istek varsa: ekrandaki yazı hâlâ aynıysa (gürültüyle yeniden istenmişse) yine göster.
    if (seq !== reqSeq && sigDiff(sig, lastReqSig) > STILL_SAME) return;
    if (out.tr) { shown = out.tr; shownSig = sig; pendingSince = 0; minUntil = Date.now() + readTime(out.tr); openBox({ en: out.en, tr: out.tr, bbox: bbox || sig.bbox }); }
    else if (shown && Date.now() < minUntil) { pendingSince = 0; emit({ peekEnd: true }); }
    else closeBox();
    if (out.rejected) log('REDDEDİLDİ (' + out.rejected + ')');
    log((ms != null ? 'çeviri ' + ms + ' ms (Gemini ' + out.ms + ' ms' + (out.reused ? '' : ', YENİ BAĞLANTI') + '; ' + lastTiming + ')' : 'önbellek') + ': ' + (out.en || '(altyazı yok)'));
  }
  while (running) {
    try {
      if (Date.now() - lastBeat > 10000) { lastBeat = Date.now(); log('nabız: kare ' + stats.frames + ', istek ' + stats.calls + ', önbellek ' + stats.cacheHits + ', hata ' + stats.errors + ', bekleyen ' + inFlight + (shade ? ', kutu açık' : '')); }
      loopStage = 'kare bekleniyor';
      if (!latest) await withTimeout(waitFrame(), 8000, 'kare');
      var fr = latest; latest = null;
      if (!fr) continue;
      loopStage = 'çözme';
      var tDec = Date.now();
      var img = await decodeJpeg(fr.buf);
      var tSig = Date.now();
      var box = regionBox(img, EN_REGION);
      var sh = shade;
      var sig = signature(img, box, sh);
      if (rebase) {
        // Kutu açıldı / büyüdü: maske değiştiği için imza da biraz değişir. Yazı aynıysa bu kareyi yeni referans al;
        // bu arada yeni bir cümle geldiyse referansı bozma ki değişim fark edilsin.
        rebase = false;
        if (sigDiff(sig, lastSentSig) < 0.5) { lastSentSig = sig; if (shown) shownSig = sig; continue; }
      }
      var hasText = looksLikeSubtitle(sig);   // sadece ortalanmış, ince çizgili yazı satırı altyazı sayılır
      debugFrame(fr.buf, (boxOpen ? (shown ? 'TR' : 'BOS-KUTU') : 'kutu-yok') + '_' + (hasText ? 'yazi' : 'bos'));
      if (hasText) growBox(sig.bbox);
      if (!hasText) {
        emptyFrames++;
        if (emptyFrames >= 2) {
          lastSentSig = null;
          if (shown && Date.now() < minUntil) { /* okuma süresi dolmadı: Türkçe kalsın */ }
          else { reqSeq++; closeBox(); }
        }
      } else {
        emptyFrames = 0;
        if (peekSince) {
          var ready = peekAckAt && fr.startedAt > peekAckAt;
          if (!ready && Date.now() - peekSince < 2000) continue;          // göz atma karesini bekle
          peekSince = 0; lastSentSig = null;                                  // bu kareyle istek gönderilsin
        }
        if (pendingSince && Date.now() - pendingSince > 3500) { pendingSince = 0; if (shown) emit({ peekEnd: true }); else closeBox(); }
        if (sigDiff(sig, lastSentSig) > CHANGED) {   // yeni / farklı yazı
          // Altyazı belirirken solup parlar: uçuşta aynı yazı için istek varsa yenisini gönderme.
          if (inFlight > 0 && sigDiff(sig, lastReqSig) < 0.5) { lastSentSig = sig; continue; }
          if (boxOpen && shown && sigDiff(sig, shownSig) > CHANGED) {
            // Kutu altındaki yeni İngilizce soluk okunur ve bozulabilir. Eski Türkçe ekranda KALIR; kutu sadece bir an
            // yarı saydam olur (göz atma), ondan sonraki net kareyle okunur. Ekranda hiç boş siyah kutu olmaz.
            peekSince = Date.now(); peekAckAt = 0; pendingSince = Date.now();
            emit({ peek: true });
            lastSentSig = sig;
            continue;
          }
          lastSentSig = sig; lastReqSig = sig;
          debugFrame(fr.buf, 'ISTEK', true);
          var seq = ++reqSeq, hit = null;
          for (var c = 0; c < sigCache.length; c++) if (sigDiff(sig, sigCache[c].sig) < SAME) { hit = sigCache[c].out; break; }
          lastTiming = 'yakalama ' + fr.capMs + ' ms, çözme ' + (tSig - tDec) + ' ms, imza ' + (Date.now() - tSig) + ' ms';
          if (hit) { stats.cacheHits++; show(seq, sig, hit, null, sig.bbox); }
          else if (Date.now() > backoffUntil && CONFIG.geminiKey && inFlight < 3) {
            stats.calls++; inFlight++; lastGemini = Date.now();
            (function (seq, sig, jpg, tc, bbox) {
              withTimeout(readAndTranslate(jpg), 8000, 'çeviri').then(function (out) {
                var k = normEn(out.en);
                if (out.en) prevEn = out.en;
                if (k && cacheByEn[k]) out.tr = cacheByEn[k];          // aynı cümle hep aynı çeviri
                if (k) remember(out.en, out.tr);
                sigCache.unshift({ sig: sig, out: out }); if (sigCache.length > 300) sigCache.pop();   // boş sonuç da: aynı gürültü için tekrar sorma
                show(seq, sig, out, Date.now() - tc, bbox);
              }).catch(function (e) {
                stats.errors++; log('çeviri hatası: ' + e.message);
                if (e.status === 429) backoffUntil = Date.now() + 15000;
                if (seq === reqSeq) lastSentSig = null;  // tekrar denensin
              }).then(function () { inFlight--; });
            })(seq, sig, cropForGemini(img, box, sh), Date.now(), sig.bbox);
          }
        }
      }
    } catch (e) {
      stats.errors++;
      log('hata: ' + (e && e.message));
      await sleep(500);
    }
  }
}

var keepAlive = null;
service.register('start', function (message) {
  if (message.isSubscription) subscribers.push(message);
  log('hafıza: ' + Object.keys(cacheByEn).length + ' cümle (' + (MEMORY_FILE || 'yazılamıyor') + ')');
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
service.register('boxRect', function (m) {
  var p = m.payload || {};
  shade = p.none ? null : { x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1, alpha: p.alpha || BOX_ALPHA, hasText: p.hasText !== false };
  rebase = true;
  if (p.peek) peekAckAt = Date.now();
  m.respond({ returnValue: true });
});
service.register('stats', function (m) { m.respond(Object.assign({ returnValue: true, model: MODEL, stage: loopStage, running: running }, stats)); });
service.register('showInput', function (m) {
  // Uygulamadan çıkarken TV'nin kendi HDMI ekranına güvenli dönüş.
  var id = 'com.webos.app.hdmi' + ((m.payload && m.payload.port) || 1);
  lunaCall('luna://com.webos.applicationManager/launch', { id: id }).then(function (r) { m.respond(r || { returnValue: true }); });
});
module.exports = { _test: { looksEnglish: looksEnglish, looksLikeSubtitle: looksLikeSubtitle, regionBox: regionBox, signature: signature, sigDiff: sigDiff, cropForGemini: cropForGemini, decodeJpeg: decodeJpeg, initDecoder: initDecoder, EN_REGION: EN_REGION } };
