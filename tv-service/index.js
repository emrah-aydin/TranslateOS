// TranslateOS öz-test servisi: TV'nin içinden ekran görüntüsü alınabiliyor mu?
// Yollar: (1) doğrudan luna capture servisi, (2) TV'nin kendi SSAP'ına localhost'tan bağlanmak.
// Sonuçlar uygulamaya (abonelik) ve Mac'teki alıcıya (HTTP POST) gider.
'use strict';
var Service = require('webos-service');
var fs = require('fs');
var http = require('http');
var https = require('https');
var WebSocket = require('ws');

var service = new Service('com.translateos.selftest.service');
var MAC = null; // { host, port } — uygulama 'receiver' parametresiyle verir (debug-config.js)
var KEY_FILE = '/tmp/translateos_client_key_v2';
// aiowebostv'nin LG imzalı kayıt bilgisi (Home Assistant'ın kullandığı); önce imzalı, reddedilirse imzasız gönderilir.
var REGISTRATION = require('./registration.json');
var keepAlive = null;

function post(path, body, contentType) {
  if (!MAC) return;
  try {
    var data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    var req = http.request({ host: MAC.host, port: MAC.port, path: path, method: 'POST',
      headers: { 'Content-Type': contentType || 'application/json', 'Content-Length': data.length } });
    req.on('error', function () {});
    req.setTimeout(5000, function () { req.abort(); });
    req.end(data);
  } catch (e) {}
}

function lunaCall(uri, params) {
  return new Promise(function (resolve) {
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; resolve({ timeout: true }); } }, 15000);
    service.call(uri, params, function (m) {
      if (done) return; done = true; clearTimeout(t);
      resolve(m.payload);
    });
  });
}

function fetchImage(uri) {
  return new Promise(function (resolve) {
    var mod = uri.indexOf('https:') === 0 ? https : http;
    var req = mod.get(uri, { rejectUnauthorized: false }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, buf: Buffer.concat(chunks) }); });
    });
    req.on('error', function (e) { resolve({ error: String(e) }); });
    req.setTimeout(10000, function () { req.abort(); });
  });
}

var MANIFEST_PERMS = ['LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'CONTROL_TV_SCREEN', 'READ_RUNNING_APPS',
  'READ_INPUT_DEVICE_LIST', 'WRITE_NOTIFICATION_TOAST', 'READ_APP_STATUS', 'CONTROL_INPUT_TV', 'READ_INSTALLED_APPS'];

function ssapSession(url, log) {
  // Bağlanır, eşleşir; { request(uri, payload) , close() } döner.
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket(url, { rejectUnauthorized: false, handshakeTimeout: 8000 });
    var pending = {}, n = 0, registered = false;
    var timer = setTimeout(function () { reject(new Error('eşleşme zaman aşımı (90 sn)')); try { ws.terminate(); } catch (e) {} }, 90000);
    function send(o) { ws.send(JSON.stringify(o)); }
    var signed = true;
    function register() {
      var key = null; try { key = fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch (e) {}
      var p = JSON.parse(JSON.stringify(REGISTRATION));
      if (!signed) {
        var m = p.manifest; delete m.signatures;
        var perms = {}; m.permissions.concat(m.signed.permissions).forEach(function (x) { perms[x] = 1; });
        m.permissions = Object.keys(perms).sort(); delete m.signed;
      }
      if (key) p['client-key'] = key;
      log('kayıt gönderildi (' + (signed ? 'imzalı' : 'imzasız') + ')' + (key ? ' (kayıtlı anahtarla)' : ' — TV\'de izin sorusu çıkmalı'));
      send({ type: 'register', id: 'reg0', payload: p });
    }
    ws.on('open', function () { log('bağlandı: ' + url); register(); });
    ws.on('error', function (e) { clearTimeout(timer); reject(e); });
    ws.on('close', function (c) { if (!registered) { clearTimeout(timer); reject(new Error('bağlantı kapandı ' + c)); } });
    ws.on('message', function (raw) {
      var m; try { m = JSON.parse(String(raw)); } catch (e) { return; }
      if (m.id === 'reg0') {
        if (m.type === 'registered') {
          registered = true; clearTimeout(timer);
          try { fs.writeFileSync(KEY_FILE, m.payload['client-key']); } catch (e) {}
          log('EŞLEŞTİ');
          resolve({
            request: function (uri, payload) {
              return new Promise(function (res2) {
                var id = 'r' + (n++); pending[id] = res2;
                send({ type: 'request', id: id, uri: uri, payload: payload || {} });
                setTimeout(function () { if (pending[id]) { delete pending[id]; res2({ timeout: true }); } }, 15000);
              });
            },
            close: function () { try { ws.close(); } catch (e) {} }
          });
        } else if (m.type === 'error' && signed) {
          log('imzalı kayıt reddedildi: ' + JSON.stringify(m.error || m).slice(0, 150) + ' — imzasız deneniyor');
          signed = false; register();
        } else if (m.type === 'error') {
          clearTimeout(timer); reject(new Error('kayıt hatası: ' + JSON.stringify(m)));
        } else {
          log('kayıt cevabı: ' + JSON.stringify(m.payload || m).slice(0, 200));
        }
        return;
      }
      if (pending[m.id]) { var f = pending[m.id]; delete pending[m.id]; f(m.type === 'error' ? { error: m.error, payload: m.payload } : m.payload); }
    });
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function runTests(emit) {
  var results = {};
  function log(s) { emit({ log: s }); post('/log', { log: s }); }

  log('Servis çalışıyor. Node ' + process.version);

  // 1) Doğrudan luna capture
  var lunaUris = ['luna://com.webos.service.capture/executeOneShot', 'luna://com.webos.service.tv.capture/executeOneShot'];
  for (var i = 0; i < lunaUris.length; i++) {
    var r = await lunaCall(lunaUris[i], { path: '/tmp/translateos_luna.jpg', method: 'DISPLAY', format: 'JPG', width: 960, height: 540 });
    results['luna' + i] = r;
    log('LUNA ' + lunaUris[i].split('/')[2] + ' → ' + JSON.stringify(r).slice(0, 220));
  }

  // 2) SSAP: localhost 1008 ile reddediliyor (webOS 26); TV'nin kendi ağ adresi denenir.
  var net = await lunaCall('luna://com.palm.connectionmanager/getStatus', {});
  var ownIps = [];
  ['wired', 'wifi'].forEach(function (k) { if (net && net[k] && net[k].ipAddress) ownIps.push(net[k].ipAddress); });
  log('TV\'nin ağ adres(ler)i: ' + (ownIps.join(', ') || 'bulunamadı ' + JSON.stringify(net).slice(0, 150)));
  var urls = [];
  ownIps.forEach(function (ip) { urls.push('wss://' + ip + ':3001'); urls.push('ws://' + ip + ':3000'); });
  urls.push('wss://127.0.0.1:3001');
  var sess = null;
  for (var j = 0; j < urls.length && !sess; j++) {
    try { sess = await ssapSession(urls[j], log); results.ssapUrl = urls[j]; }
    catch (e) { log('SSAP ' + urls[j] + ' başarısız: ' + (e && e.message)); }
  }
  if (!sess) { log('SONUÇ: SSAP ile bağlanılamadı.'); emit({ done: true, results: results }); return; }

  async function capture(tag) {
    var t0 = Date.now();
    var c = await sess.request('ssap://tv/executeOneShot', { path: '/tmp/capture.jpg', method: 'DISPLAY', format: 'JPG' });
    var dt = Date.now() - t0;
    log('[' + tag + '] executeOneShot ' + dt + ' ms → ' + JSON.stringify(c).slice(0, 200));
    if (c && c.imageUri) {
      var img = await fetchImage(c.imageUri);
      if (img.buf) {
        log('[' + tag + '] resim indirildi: ' + img.buf.length + ' bayt (HTTP ' + img.status + ')');
        post('/img?tag=' + tag, img.buf, 'image/jpeg');
        emit({ image: 'data:image/jpeg;base64,' + img.buf.toString('base64'), tag: tag });
        return true;
      }
      log('[' + tag + '] indirme hatası: ' + img.error);
    }
    return false;
  }

  var okApp = await capture('uygulama-onde');
  results.okApp = okApp;

  // 3) HDMI öne alınır, servis arka planda yakalar
  log('5 sn sonra HDMI 1 öne alınacak, servis arka planda oyun görüntüsünü yakalayacak…');
  await sleep(5000);
  var l = await lunaCall('luna://com.webos.applicationManager/launch', { id: 'com.webos.app.hdmi1' });
  log('HDMI açma → ' + JSON.stringify(l).slice(0, 150));
  await sleep(4000);
  var okHdmi = false;
  for (var k = 0; k < 6; k++) { okHdmi = (await capture('hdmi-' + k)) || okHdmi; await sleep(400); }
  results.okHdmi = okHdmi;
  log('SONUÇ: uygulama önde=' + okApp + ', HDMI önde (arka plan servis)=' + okHdmi);
  sess.close();
  emit({ done: true, results: results });
}

service.register('run', function (message) {
  var rcv = message.payload && message.payload.receiver;
  if (rcv) { var hp = String(rcv).split(':'); MAC = { host: hp[0], port: Number(hp[1] || 8790) }; }
  if (!keepAlive) {
    service.activityManager.create('translateos-keepalive', function (a) { keepAlive = a; });
  }
  function emit(o) { try { message.respond(Object.assign({ returnValue: true }, o)); } catch (e) {} }
  emit({ log: 'başladı' });
  runTests(emit).catch(function (e) {
    var s = 'BEKLENMEYEN HATA: ' + (e && e.stack || e);
    emit({ log: s }); post('/log', { log: s });
  }).then(function () {
    if (keepAlive) { service.activityManager.complete(keepAlive, function () {}); keepAlive = null; }
  });
});

service.register('ping', function (m) { m.respond({ returnValue: true, node: process.version }); });
