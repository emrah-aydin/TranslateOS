// TranslateOS ekranı: PS5 görüntüsü uygulamanın içinde, Türkçe altyazı İngilizcenin tam üstünde.
// Oyun sırasında bu ekrandan çıkılmaz (TV'nin kendi HDMI ekranına geçiş kararmaya yol açıyor).
(function () {
  var W = 1920, H = 1080;
  var KEY = { BACK: 461, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, OK: 13 };
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
  var ABOVE_BOTTOM = 134;   // px: altyazı bölgesinin (%87,8 = 948 px) hemen üstü; iki satırlık İngilizcenin de üstünde kalır
  var COVER_BOTTOM = 36;    // px: İngilizcenin alt kenarının biraz altı; kutu yukarı doğru büyür
  function placeBox(bbox) {
    var padX = 26, padY = 12;
    var b = bbox || { x0: 0.3, x1: 0.7, y0: 0.9, y1: 0.95 };
    subEl.style.left = (W / 2) + 'px';
    subEl.style.transform = 'translateX(-50%)';
    if (placement === 'above') {
      // İngilizcenin üstünde: ikisi birlikte görünür (senkron kontrolü için). Normalde sabit yükseklik;
      // İngilizce daha yukarıdan başlıyorsa (3 satır gibi) kutu o cümle için yukarı çıkar, İngilizceye asla binmez.
      // İngilizcenin hemen üstü (10 px boşluk). Kutu açıkken servis İngilizce alanını sadece büyütür; böylece konuşma
      // boyunca kutu en yüksek konumda sabit kalır, satır sayısı değiştikçe zıplamaz.
      // Sabit yükseklik: servisin altyazı bölgesinin (%86,5) hemen üstü. Kutu bölgeye taşmaz (servis kendi kutusunu yeni
      // yazı sanmaz) ve konuşma boyunca zıplamaz. İngilizce daha yukarıdan başlarsa (3 satır) kutu onun üstüne çıkar.
      subEl.style.bottom = Math.max(ABOVE_BOTTOM, Math.round((1 - b.y0) * H + 10)) + 'px';
      subEl.style.maxWidth = '1100px';   // mini haritaya binmesin
      subEl.style.minWidth = '0px';
      subEl.style.minHeight = '0px';
    } else {
      // İngilizcenin yerine: alt kenar sabit; kutu İngilizceden her yönde belirgin biçimde büyük (uçlardaki
      // soluk harfler ve noktalama da kalsın diye ekstra pay)
      var coverPadX = 48 + W * 0.02, coverPadY = 18;
      var halfW = Math.max(Math.abs(b.x0 - 0.5), Math.abs(b.x1 - 0.5)) * W;
      subEl.style.bottom = Math.max(0, COVER_BOTTOM - 10) + 'px';
      // İngilizceyi tam örtecek kadar geniş; Türkçe metin ise 1100 px'te kırılır (mini haritaya gereksiz yere binmesin)
      var coverW = 2 * halfW + 2 * coverPadX;
      subEl.style.minWidth = coverW + 'px';
      subEl.style.maxWidth = Math.max(1100, coverW) + 'px';
      subEl.style.minHeight = Math.max(0, (H - COVER_BOTTOM + 10) - b.y0 * H + coverPadY) + 'px';
    }
  }
  // Kutu koyuluğu: Türkçe varken %90; yeni İngilizceye "göz atarken" bir an %50 (servis net okuyabilsin).
  var ALPHA_TEXT = 0.9, ALPHA_PEEK = 0.6, ALPHA_SOFT = 0.72, alpha = ALPHA_TEXT, hasText = false;   // göz atma: göze daha az belli olsun (alttaki İngilizce 4 kat parlatılarak okunur)
  // Örtü rengi sahneden gelir (koyu ton); kenarlar aynı renkte yumuşak gölgeyle sahneye karışır.
  var bg = [0, 0, 0];
  function paint() {
    var c = bg[0] + ',' + bg[1] + ',' + bg[2];
    subEl.style.background = 'rgba(' + c + ',' + alpha + ')';
    // "Üstte" modunda gölge küçük: alttaki İngilizceye taşmasın
    var sh = placement === 'above' ? '0 0 14px 6px' : '0 0 26px 16px';
    subEl.style.boxShadow = sh + ' rgba(' + c + ',' + (alpha * 0.9).toFixed(2) + ')';
  }
  function setAlpha(a) { alpha = a; paint(); }
  function reportRect(peek) {
    // Servise kutunun gerçek yerini ve koyuluğunu bildir: altındaki İngilizceyi okumaya devam edebilsin.
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      if (subEl.style.display === 'none') { luna('rect', SVC + 'boxRect', { none: true }); return; }
      var r = subEl.getBoundingClientRect();
      luna('rect', SVC + 'boxRect', { x0: (r.left - 2) / W, y0: (r.top - 2) / H, x1: (r.right + 2) / W, y1: (r.bottom + 2) / H,
        alpha: alpha, hasText: hasText, peek: !!peek, bg: bg });
    }); });
  }
  function showSub(tr, bbox) {
    if (!enabled) return hideSub();
    if (bbox) lastBbox = bbox;
    placeBox(lastBbox);
    // Birden çok cümle: en yenisi (en alttaki) öne çıkar, öncekiler soluk ve küçük kalır
    var parts = String(tr).split('\n');
    subEl.innerHTML = parts.map(function (p, i) {
      var t = p.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
      return '<span class="' + (i === parts.length - 1 ? 'cur' : 'old') + '">' + t + '</span>';
    }).join('');
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
  // Sol üst ipucunun Türkçesi: İngilizce kutunun tam üzerinde; (O), (X) gibi tuşlar PlayStation simgesiyle çizilir
  var helpEl = document.getElementById('help');
  var BTN = {
    'X': '<svg class="btn" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="#1c1c1c" stroke="#fff" stroke-width="1.5"/><path d="M9 9l10 10M19 9L9 19" stroke="#7aa7ff" stroke-width="2.6" stroke-linecap="round"/></svg>',
    'O': '<svg class="btn" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="#1c1c1c" stroke="#fff" stroke-width="1.5"/><circle cx="14" cy="14" r="5.5" fill="none" stroke="#ff5a6a" stroke-width="2.6"/></svg>',
    '△': '<svg class="btn" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="#1c1c1c" stroke="#fff" stroke-width="1.5"/><path d="M14 8l6 10H8z" fill="none" stroke="#3fd6a6" stroke-width="2.4" stroke-linejoin="round"/></svg>',
    '□': '<svg class="btn" viewBox="0 0 28 28"><circle cx="14" cy="14" r="12" fill="#1c1c1c" stroke="#fff" stroke-width="1.5"/><rect x="9" y="9" width="10" height="10" fill="none" stroke="#f08ad6" stroke-width="2.4"/></svg>'
  };
  BTN['○'] = BTN['O']; BTN['×'] = BTN['X']; BTN['TRIANGLE'] = BTN['△']; BTN['SQUARE'] = BTN['□']; BTN['CIRCLE'] = BTN['O']; BTN['CROSS'] = BTN['X'];
  function helpHtml(t) {
    var esc = String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    return esc.replace(/\(([^()\s]{1,10})\)/g, function (m, k) {
      var key = k.toUpperCase();
      if (BTN[key] || BTN[k]) return BTN[key] || BTN[k];
      if (/^(L[123]|R[123]|OPTIONS|TOUCHPAD|UP|DOWN|LEFT|RIGHT|SHARE)$/.test(key)) {
        var lab = { UP: '↑', DOWN: '↓', LEFT: '←', RIGHT: '→', TOUCHPAD: 'Dokunmatik', OPTIONS: 'OPTIONS', SHARE: 'SHARE' }[key] || key;
        return '<span class="lbl">' + lab + '</span>';
      }
      return m;
    });
  }
  function reportHelpRect() {
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      if (helpEl.style.display === 'none') { luna('helprect', SVC + 'helpRect', { none: true }); return; }
      var r = helpEl.getBoundingClientRect();
      luna('helprect', SVC + 'helpRect', { x0: (r.left - 2) / W, y0: (r.top - 2) / H, x1: (r.right + 2) / W, y1: (r.bottom + 2) / H, alpha: 0.9 });
    }); });
  }
  function showHelp(h) {
    if (!h || !h.tr || !enabled) { helpEl.style.display = 'none'; reportHelpRect(); return; }
    helpEl.innerHTML = helpHtml(h.tr);
    helpEl.style.left = Math.round(h.x0 * W - 18) + 'px';
    helpEl.style.top = Math.round(h.y0 * H - 14) + 'px';
    helpEl.style.minWidth = Math.round((h.x1 - h.x0) * W + 36) + 'px';
    helpEl.style.minHeight = Math.round((h.y1 - h.y0) * H + 28) + 'px';
    helpEl.style.display = 'block';
    reportHelpRect();
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
      if (r.placement) placement = r.placement;
      document.getElementById('m-place').textContent = placement === 'above' ? 'Üstte' : 'Altta';
      if (r.placement) placement = r.placement;
    });
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

  // Giriş: başlatma parametresiyle verilmediyse, cihaz bağlı olan HDMI girişini servis seçer (en fazla 2,5 sn beklenir)
  var portFixed = !!(lp && lp.hdmi);
  function autoInput() {
    if (portFixed) { showHdmi(port); return; }
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; showHdmi(port); } }, 2500);
    luna('pick', SVC + 'pickInput', {}, function (r) {
      if (done) { if (r && r.port && r.port !== port) { port = r.port; showHdmi(port); } return; }
      done = true; clearTimeout(t);
      if (r && r.port) port = r.port;
      showHdmi(port);
    });
  }
  autoInput();
  blockScreenSaver();
  // Açılış: sol üstte rozet + kısa tuş ipucu. TV uygulamayı arka planda bekletip yeniden öne getirdiğinde de gösterilir.
  var welcomeTimer = null;
  function welcome() {
    badgeEl.style.opacity = '1';
    clearTimeout(welcomeTimer);
    welcomeTimer = setTimeout(function () { badgeEl.style.opacity = '0'; }, 6000);
    status('Menüyü açmak için kumandadan OK tuşuna basın', 7000);
  }
  welcome();
  var lastResume = 0;
  function resumed(params) {
    if (Date.now() - lastResume < 1500) return;   // öne gelme olayı iki kez gelebilir
    lastResume = Date.now();
    try { var p = typeof params === 'string' ? JSON.parse(params) : (params || {}); if (p.menu) setTimeout(function () { toggleMenu(true); }, 1000); } catch (e) {}
    autoInput();             // Geri ile çıkınca HDMI görüntüsü bırakılmıştı; bu arada başka girişe geçilmiş olabilir
    welcome();
    subscribe();             // Geri ile durdurulan çeviriyi hemen yeniden başlat
  }
  document.addEventListener('webOSRelaunch', function (ev) { resumed(ev && ev.detail); });
  var wasHidden = false;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { wasHidden = true; return; }
    if (wasHidden) { wasHidden = false; resumed(); }
  });

  // --- Kurulum ekranı (QR) ---
  var setupEl = document.getElementById('setup');
  function showSetup() {
    luna('setup', SVC + 'setupInfo', {}, function (r) {
      if (!r.url) { status('TV ağ adresi bulunamadı', 5000); return; }
      try {
        var qr = qrcode(0, 'M'); qr.addData(r.url); qr.make();
        document.getElementById('setup-qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
      } catch (e) { document.getElementById('setup-qr').textContent = ''; }
      document.getElementById('setup-url').textContent = r.url;
      setupEl.style.display = 'block';
      toggleMenu(false);
    });
  }
  function hideSetup() { setupEl.style.display = 'none'; }

  // Servise abone ol; servis düşer ya da abonelik koparsa kendiliğinden yeniden bağlan.
  var resubTimer = null;
  function subscribe() {
    clearTimeout(resubTimer);
    if (bridges.start) { try { bridges.start.cancel(); } catch (e) {} }   // eski aboneliği kapat (çift bağlantı olmasın)
    luna('start', SVC + 'start', { subscribe: true }, function (r) {
      if (r.returnValue === false) {
        status('Servis yeniden bağlanıyor…', 3000);
        resubTimer = setTimeout(subscribe, 1000);
        return;
      }
      if (r.status === 'pairing') status('TV\'de çıkan izin isteğini onayla', 0);
      if (r.status === 'nokey' || (r.status === 'started' && r.hasKey === false && !r.keyless)) showSetup();
      if (r.status === 'quota') status(r.scope === 'global' ? 'Bugünlük ortak çeviri kotası doldu. Mavi tuşla kendi ücretsiz Gemini anahtarını girebilirsin.' : 'Bu TV\'nin bugünlük çeviri kotası doldu. Mavi tuşla kendi ücretsiz Gemini anahtarını girebilirsin.', 10000);
      if (r.status === 'keySaved') { hideSetup(); status('Anahtar kaydedildi, çeviri başladı', 4000); }
      if (r.status === 'captureFailed') status('Bu TV ekran görüntüsü vermiyor; çeviri yapılamıyor. Lütfen GitHub\'da bildir.', 0);
      if (r.clear) hideSub();
      if (r.pending) pendingSub(r.bbox, r.peek);
      else if (r.peek && subEl.style.display !== 'none') { setAlpha(r.soft ? ALPHA_SOFT : ALPHA_PEEK); reportRect(true); }   // soft: düzenli kontrol, göze daha az belli   // eski Türkçe kalır, kutu bir an açılır
      if (r.peekEnd && subEl.style.display !== 'none') { setAlpha(ALPHA_TEXT); reportRect(); }
      if (r.placement) placement = r.placement;
      if (r.bg) { bg = r.bg; paint(); }
      if (r.help !== undefined) showHelp(r.help);
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
      if (r.placement) placement = r.placement;
      if (r.returnValue === false || r.running === false) subscribe();
    });
  }, 10000);

  document.addEventListener('keydown', function (e) {
    if (e.keyCode === KEY.YELLOW) {
      placement = placement === 'above' ? 'cover' : 'above';
      luna('place', SVC + 'setPlacement', { placement: placement });
      if (subEl.style.display !== 'none') { placeBox(lastBbox); reportRect(); }
      status(placement === 'above' ? 'Çeviri yeri: üstte' : 'Çeviri yeri: altta (İngilizcenin yerine)', 3000);
      if (menuEl.style.display === 'block') refreshMenu();
      e.preventDefault();
    } else if (e.keyCode === KEY.BLUE) {
      if (setupEl.style.display === 'block') hideSetup(); else showSetup();
      e.preventDefault();
    } else if (e.keyCode === KEY.GREEN || e.keyCode === KEY.OK) {
      toggleMenu();
      e.preventDefault();
    } else if (e.keyCode === KEY.BACK) {
      e.preventDefault();
      if (setupEl.style.display === 'block') { hideSetup(); return; }
      if (menuEl.style.display === 'block') { toggleMenu(false); return; }
      // Çıkış: TV'nin HDMI uygulamasını açıkça başlat (kendiliğinden dönüş siyah ekranda takılıyor).
      luna('stop', SVC + 'stop', {});
      luna('exit', SVC + 'showInput', { port: port });
    } else if (e.keyCode >= 49 && e.keyCode <= 52) {
      port = e.keyCode - 48;
      showHdmi(port);
      luna('setinput', SVC + 'setInput', { port: port });   // seçim hatırlansın
      status('HDMI ' + port, 2000);
    }
  });
})();
