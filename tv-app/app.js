(function () {
  // Test sonuçlarını Mac'e göndermek için isteğe bağlı alıcı adresi: debug-config.js (git dışı)
  var RECEIVER = window.DEBUG_RECEIVER || '';
  var MAC = RECEIVER ? 'http://' + RECEIVER : '';
  var logEl = document.getElementById('log');
  var bridges = [];

  function log(s, cls) {
    var d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = new Date().toTimeString().slice(0, 8) + '  ' + s;
    logEl.appendChild(d);
    if (MAC) try {
      var x = new XMLHttpRequest();
      x.open('POST', MAC + '/log'); x.setRequestHeader('Content-Type', 'application/json');
      x.send(JSON.stringify({ log: '[app] ' + s }));
    } catch (e) {}
  }

  function luna(uri, params, cb) {
    var b = new PalmServiceBridge();
    bridges.push(b);
    b.onservicecallback = function (r) { var o; try { o = JSON.parse(r); } catch (e) { o = { raw: r }; } cb(o); };
    b.call(uri, JSON.stringify(params || {}));
  }

  log('Uygulama açıldı. UA: ' + navigator.userAgent);

  // A) Web uygulamasından doğrudan luna capture
  luna('luna://com.webos.service.capture/executeOneShot',
    { path: '/tmp/translateos_app.jpg', method: 'DISPLAY', format: 'JPG', width: 960, height: 540 },
    function (r) { log('Web app → luna capture: ' + JSON.stringify(r).slice(0, 200), r.returnValue ? 'ok' : 'bad'); });

  // D) Web uygulamasından localhost WebSocket erişimi
  ['ws://127.0.0.1:3000', 'wss://127.0.0.1:3001'].forEach(function (u) {
    try {
      var ws = new WebSocket(u);
      ws.onopen = function () { log('Web app WebSocket AÇILDI: ' + u, 'ok'); ws.close(); };
      ws.onerror = function () { log('Web app WebSocket hata: ' + u, 'bad'); };
    } catch (e) { log('Web app WebSocket istisna: ' + u + ' ' + e, 'bad'); }
  });

  // Servis testleri
  luna('luna://com.translateos.selftest.service/run', { subscribe: true, receiver: RECEIVER }, function (r) {
    if (r.log) log('[servis] ' + r.log, /SONUÇ|EŞLEŞTİ|indirildi/.test(r.log) ? 'ok' : (/hata|başarısız|HATA/i.test(r.log) ? 'bad' : ''));
    if (r.image) { document.getElementById('img').src = r.image; document.getElementById('tag').textContent = r.tag; }
    if (r.returnValue === false) log('[servis] çağrı hatası: ' + JSON.stringify(r), 'bad');
    if (r.done) log('BİTTİ', 'ok');
  });
})();
