// TranslateOS ekranı: PS5 görüntüsü uygulamanın içinde, Türkçe altyazı İngilizcenin tam üstünde.
// Oyun sırasında bu ekrandan çıkılmaz (TV'nin kendi HDMI ekranına geçiş kararmaya yol açıyor).
(function () {
  var W = 1920, H = 1080;
  var KEY = { BACK: 461, RED: 403, GREEN: 404, YELLOW: 405, OK: 13 };
  var SVC = 'luna://com.translateos.app.service/';
  var subEl = document.getElementById('sub');
  var statusEl = document.getElementById('status');
  var menuEl = document.getElementById('menu');
  var badgeEl = document.getElementById('badge');
  var bridges = {};
  var enabled = true, port = 1, statusTimer = null, lastBbox = null, menuTimer = null, menuCloseTimer = null, placement = 'above';

  // Her çağrı için tek köprü tutulur (abonelikler çöp toplayıcıya gitmesin).
  function luna(name, uri, params, cb) {
    var b = new PalmServiceBridge();
    bridges[name] = b;
    b.onservicecallback = function (r) { var o; try { o = JSON.parse(r); } catch (e) { o = {}; } if (cb) cb(o); };
    b.call(uri, JSON.stringify(params || {}));
  }

  function status(text, ms) {
    statusEl.textContent = text;
    statusEl.style.display = 'block';
    clearTimeout(statusTimer);
    if (ms) statusTimer = setTimeout(function () { statusEl.style.display = 'none'; }, ms);
  }

  // --- Altyazı kutusu ---
  // Kutu SABİT bir yerde durur: her zaman ekranın tam ortasında ve aynı yükseklikte (kaymasın).
  // Yalnızca genişliği/yüksekliği Türkçe metne göre değişir. GTA altyazısı hep ortada; iki satırlık İngilizcenin
  // üstü ~%88,8, alt kenarı ~%95,5 yükseklikte (ölçüm).
  var ABOVE_BOTTOM = 172;   // px: iki satırlık İngilizcenin de üstünde kalır (ölçüm: 2 satırın üstü ~%86)
  var COVER_BOTTOM = 36;    // px: İngilizcenin alt kenarının biraz altı; kutu yukarı doğru büyür
  function placeBox(bbox) {
    var padX = 26, padY = 12;
    var b = bbox || { x0: 0.3, x1: 0.7, y0: 0.9, y1: 0.95 };
    subEl.style.left = (W / 2) + 'px';
    subEl.style.transform = 'translateX(-50%)';
    if (placement === 'above') {
      // İngilizcenin üstünde: ikisi birlikte görünür (senkron kontrolü için). Normalde sabit yükseklik;
      // İngilizce daha yukarıdan başlıyorsa (3 satır gibi) kutu o cümle için yukarı çıkar, İngilizceye asla binmez.
      subEl.style.bottom = Math.max(ABOVE_BOTTOM, Math.round((1 - b.y0) * H + 14)) + 'px';
      subEl.style.minWidth = '0px';
      subEl.style.minHeight = '0px';
    } else {
      // İngilizcenin yerine: alt kenar sabit; kutu en az İngilizce kadar geniş ve yüksek
      var halfW = Math.max(Math.abs(b.x0 - 0.5), Math.abs(b.x1 - 0.5)) * W;
      subEl.style.bottom = COVER_BOTTOM + 'px';
      subEl.style.minWidth = (2 * halfW + 2 * padX) + 'px';
      subEl.style.minHeight = Math.max(0, (H - COVER_BOTTOM) - b.y0 * H + padY) + 'px';
    }
  }
  // Kutu koyuluğu: Türkçe varken %90; yeni İngilizceye "göz atarken" bir an %50 (servis net okuyabilsin).
  var ALPHA_TEXT = 0.9, ALPHA_PEEK = 0.75, alpha = ALPHA_TEXT, hasText = false;   // göz atma: göze daha az belli olsun (alttaki İngilizce 4 kat parlatılarak okunur)
  function setAlpha(a) { alpha = a; subEl.style.background = 'rgba(0,0,0,' + a + ')'; }
  function reportRect(peek) {
    // Servise kutunun gerçek yerini ve koyuluğunu bildir: altındaki İngilizceyi okumaya devam edebilsin.
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      if (subEl.style.display === 'none') { luna('rect', SVC + 'boxRect', { none: true }); return; }
      var r = subEl.getBoundingClientRect();
      luna('rect', SVC + 'boxRect', { x0: (r.left - 2) / W, y0: (r.top - 2) / H, x1: (r.right + 2) / W, y1: (r.bottom + 2) / H,
        alpha: alpha, hasText: hasText, peek: !!peek });
    }); });
  }
  function showSub(tr, bbox) {
    if (!enabled) return hideSub();
    if (bbox) lastBbox = bbox;
    placeBox(lastBbox);
    subEl.textContent = tr;
    hasText = true; setAlpha(ALPHA_TEXT);
    subEl.style.display = 'flex';
    reportRect();
  }
  function pendingSub(bbox, peek) {
    // Yeni İngilizce göründü, Türkçesi yolda: kutu hemen (boş) açılır ya da boşalır.
    // peek: kutu bir an yarı saydam olur ki servis alttaki yeni İngilizceyi net okuyabilsin.
    if (!enabled) return;
    subEl.textContent = '\u00a0';
    hasText = false;
    setAlpha(peek ? ALPHA_PEEK : ALPHA_TEXT);
    if (subEl.style.display === 'none') {
      if (!bbox) return;
      lastBbox = bbox;
      placeBox(bbox);
      subEl.style.display = 'flex';
    }
    reportRect(peek);
  }
  function hideSub() {
    if (subEl.style.display === 'none') return;
    subEl.style.display = 'none';
    reportRect();
  }

  // --- HDMI ---
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

  // --- Ekran koruyucu / uyku: oyun oynanırken TV uyumasın ---
  function blockScreenSaver() {
    luna('ss', 'luna://com.webos.service.tvpower/power/registerScreenSaverRequest',
      { subscribe: true, clientName: 'com.translateos.app' }, function (r) {
        if (r.timestamp) {
          luna('ssr', 'luna://com.webos.service.tvpower/power/responseScreenSaverRequest',
            { clientName: 'com.translateos.app', ack: false, timestamp: r.timestamp });
        }
      });
  }

  // --- Menü ---
  function refreshMenu() {
    luna('stats', SVC + 'stats', {}, function (r) {
      document.getElementById('m-calls').textContent = r.calls || 0;
      document.getElementById('m-mem').textContent = r.memory || 0;
    });
    document.getElementById('m-sub').textContent = enabled ? 'Açık' : 'Kapalı';
    document.getElementById('m-place').textContent = placement === 'above' ? 'İngilizcenin üstünde' : 'İngilizcenin yerine';
  }
  function toggleMenu(show) {
    var open = show === undefined ? menuEl.style.display !== 'block' : show;
    menuEl.style.display = open ? 'block' : 'none';
    clearInterval(menuTimer);
    clearTimeout(menuCloseTimer);
    if (open) {
      refreshMenu(); menuTimer = setInterval(refreshMenu, 2000);
      menuCloseTimer = setTimeout(function () { toggleMenu(false); }, 10000);   // oyunu kapatmasın
    }
  }

  // --- Başlangıç ---
  try {
    var lp = JSON.parse(window.PalmSystem && window.PalmSystem.launchParams || '{}') || {};
    if (lp.hdmi >= 1 && lp.hdmi <= 4) port = Number(lp.hdmi);
    if (lp.menu) setTimeout(function () { toggleMenu(true); }, 1500);
  } catch (e) {}

  showHdmi(port);
  blockScreenSaver();
  setTimeout(function () { badgeEl.style.opacity = '0'; }, 6000);
  status('Menü için yeşil tuş', 4000);

  // Servise abone ol; servis düşer ya da abonelik koparsa kendiliğinden yeniden bağlan.
  var resubTimer = null;
  function subscribe() {
    clearTimeout(resubTimer);
    luna('start', SVC + 'start', { subscribe: true }, function (r) {
      if (r.returnValue === false) {
        status('Servis yeniden bağlanıyor…', 3000);
        resubTimer = setTimeout(subscribe, 1000);
        return;
      }
      if (r.status === 'pairing') status('TV\'de çıkan izni onaylayın', 0);
      if (r.status === 'ready') status('Altyazı çevirisi hazır', 3000);
      if (r.status === 'nokey') status('Gemini anahtarı yok', 0);
      if (r.clear) hideSub();
      if (r.pending) pendingSub(r.bbox, r.peek);
      else if (r.peek && subEl.style.display !== 'none') { setAlpha(ALPHA_PEEK); reportRect(true); }   // eski Türkçe kalır, kutu bir an açılır
      if (r.peekEnd && subEl.style.display !== 'none') { setAlpha(ALPHA_TEXT); reportRect(); }
      if (r.placement) placement = r.placement;
      if (r.tr) showSub(r.tr, r.bbox);
      else if (r.bbox && !r.pending && subEl.style.display !== 'none') {
        // İngilizce büyüdü (ör. yeni satır geldi): örtü büyüsün / üstteki kutu gerekirse yukarı çıksın
        if (placement === 'cover' || r.bbox.y0 < (lastBbox ? lastBbox.y0 : 1)) { lastBbox = r.bbox; placeBox(r.bbox); reportRect(); }
      }
    });
  }
  subscribe();
  // Bekçi: servis döngüsü durmuşsa yeniden başlat.
  setInterval(function () {
    luna('watch', SVC + 'stats', {}, function (r) {
      if (r.returnValue === false || r.running === false) subscribe();
    });
  }, 10000);

  document.addEventListener('keydown', function (e) {
    if (e.keyCode === KEY.RED) {
      enabled = !enabled;
      if (!enabled) hideSub();
      status(enabled ? 'Altyazı açık' : 'Altyazı kapalı', 2000);
      if (menuEl.style.display === 'block') refreshMenu();
      e.preventDefault();
    } else if (e.keyCode === KEY.YELLOW) {
      placement = placement === 'above' ? 'cover' : 'above';
      luna('place', SVC + 'setPlacement', { placement: placement });
      if (subEl.style.display !== 'none') { placeBox(lastBbox); reportRect(); }
      status(placement === 'above' ? 'Türkçe: İngilizcenin üstünde' : 'Türkçe: İngilizcenin yerine', 2500);
      if (menuEl.style.display === 'block') refreshMenu();
      e.preventDefault();
    } else if (e.keyCode === KEY.GREEN || e.keyCode === KEY.OK) {
      toggleMenu();
      e.preventDefault();
    } else if (e.keyCode === KEY.BACK) {
      e.preventDefault();
      if (menuEl.style.display === 'block') { toggleMenu(false); return; }
      // Çıkış: TV'nin HDMI uygulamasını açıkça başlat (kendiliğinden dönüş siyah ekranda takılıyor).
      luna('stop', SVC + 'stop', {});
      luna('exit', SVC + 'showInput', { port: port });
    } else if (e.keyCode >= 49 && e.keyCode <= 52) {
      port = e.keyCode - 48;
      showHdmi(port);
      status('HDMI ' + port, 2000);
    }
  });
})();
