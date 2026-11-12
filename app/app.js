// TranslateOS ekranı: PS5 görüntüsü uygulamanın içinde, Türkçe altyazı üstünde.
// Oyun sırasında bu ekrandan çıkılmaz (TV'nin kendi HDMI ekranına geçiş kararmaya yol açıyor).
(function () {
  var KEY = { BACK: 461, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };
  var subEl = document.getElementById('sub');
  var statusEl = document.getElementById('status');
  var bridges = [];
  var enabled = true;
  var port = 1;
  var statusTimer = null;

  function luna(uri, params, cb) {
    var b = new PalmServiceBridge();
    bridges.push(b);
    b.onservicecallback = function (r) { var o; try { o = JSON.parse(r); } catch (e) { o = {}; } if (cb) cb(o); };
    b.call(uri, JSON.stringify(params || {}));
    return b;
  }

  function status(text, ms) {
    statusEl.textContent = text;
    statusEl.style.display = 'block';
    clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(function () { statusEl.style.display = 'none'; }, ms);
  }

  function showSub(tr) {
    if (!enabled || !tr) { subEl.style.display = 'none'; return; }
    subEl.textContent = tr;
    subEl.style.display = 'block';
  }

  function showHdmi(p) {
    var host = document.getElementById('hdmi');
    host.innerHTML = '';
    var v = document.createElement('video');
    v.autoplay = true;
    var s = document.createElement('source');
    s.setAttribute('type', 'service/webos-external');
    s.setAttribute('src', 'ext://hdmi:' + p);
    v.appendChild(s);
    host.appendChild(v);
  }

  try {
    var lp = JSON.parse(window.PalmSystem && window.PalmSystem.launchParams || '{}') || {};
    if (lp.hdmi >= 1 && lp.hdmi <= 4) port = Number(lp.hdmi);
  } catch (e) {}

  showHdmi(port);
  status('TranslateOS açık · Kırmızı: altyazı aç/kapat · Geri: çıkış', 5000);

  // Servise abone ol; servis düşer ya da abonelik koparsa kendiliğinden yeniden bağlan.
  var subBridge = null, resubTimer = null;
  function subscribe() {
    clearTimeout(resubTimer);
    subBridge = luna('luna://com.translateos.app.service/start', { subscribe: true }, function (r) {
      if (r.returnValue === false) {
        status('Servis yeniden bağlanıyor…', 3000);
        resubTimer = setTimeout(subscribe, 1000);
        return;
      }
      if (r.status === 'pairing') status('TV\'de çıkan izni onaylayın', 0);
      if (r.status === 'ready') status('Altyazı çevirisi hazır', 3000);
      if (r.status === 'nokey') status('Gemini anahtarı yok', 0);
      if (r.clear) showSub('');
      if (r.tr) showSub(r.tr);
    });
  }
  subscribe();
  // Bekçi: servis döngüsü durmuşsa yeniden başlat.
  setInterval(function () {
    luna('luna://com.translateos.app.service/stats', {}, function (r) {
      if (r.returnValue === false || r.running === false) subscribe();
    });
  }, 10000);

  document.addEventListener('keydown', function (e) {
    if (e.keyCode === KEY.RED) {
      enabled = !enabled;
      if (!enabled) subEl.style.display = 'none';
      status(enabled ? 'Altyazı açık' : 'Altyazı kapalı', 2000);
      e.preventDefault();
    } else if (e.keyCode === KEY.BACK) {
      e.preventDefault();
      // Çıkış: TV'nin HDMI uygulamasını açıkça başlat (kendiliğinden dönüş siyah ekranda takılıyor).
      luna('luna://com.translateos.app.service/stop', {});
      luna('luna://com.translateos.app.service/showInput', { port: port });
    } else if (e.keyCode >= 49 && e.keyCode <= 52) {
      port = e.keyCode - 48;
      showHdmi(port);
      status('HDMI ' + port, 2000);
    }
  });
})();
