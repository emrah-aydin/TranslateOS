# Araştırma ve test notları

Tarih: 12 Kasım 2026

## Soru

Bir LG webOS TV uygulaması, bilgisayar, kamera ya da capture card olmadan:

1. HDMI'daki oyun görüntüsünü okuyabilir mi?
2. Üstüne Türkçe altyazı basabilir mi?

## Bulunanlar

| Konu | Durum | Not |
|---|---|---|
| HDMI'yı uygulama içinde göstermek | Var | `<video><source type="service/webos-external" src="ext://hdmi:1">`. Sayfa arka planı şeffaf olmalı. CouchSubs bunu webOS 4.4'te doğrulamış. |
| Görüntünün üstüne altyazı basmak | Var (kendi uygulamamızda) | Şeffaf HTML katmanı. LG'nin kendi HDMI ekranının üstüne çizmenin belgelenmiş bir yolu yok. |
| Uygulamanın HDMI piksellerini okuması (canvas) | Yok | Video ayrı bir donanım katmanında çiziliyor, JavaScript'e kapalı. LG'nin resmî cevabı: ekran yakalama API'si yok. |
| Ekran görüntüsü servisi `ssap://tv/executeOneShot` | **Bu TV'de çalışıyor** | Belgelenmemiş. Eşleşmede `CONTROL_TV_SCREEN` izni isteniyor. Çalışıp çalışmadığı modele göre değişiyor (aşağıdaki tablo). |

## Test 1: Ağ üzerinden ekran görüntüsü (geçti)

- **TV:** LG 55QNED7EB3C, webOS 26 (11.2.0-2912)
- **Yöntem:** Mac'ten `aiowebostv` 1.1.0 ile `ssap://tv/executeOneShot`
- **Ekrandaki uygulama:** TV'nin kendi HDMI uygulaması (`com.webos.app.hdmi1`), PS5'te GTA V açık

| Ölçüm | Sonuç |
|---|---|
| DISPLAY / SCREEN_WITH_SOURCE_VIDEO / VIDEO / SOURCE | Dördünde de gerçek oyun görüntüsü geldi, siyah değil |
| Çözünürlük | Her zaman 960×540 (istenen boyut yok sayılıyor) |
| Hız | Saniyede yaklaşık 2 kare; bir kare 0,4–0,5 sn |
| Okunabilirlik | Altyazı ("Atomic Blimp Services. How can I help you?") ve oyun içi telefondaki küçük yazılar okunuyor |

## Test 2: TV'nin içinden (geçti)

Aynı TV'de, Developer Mode ile kurulan `tv-app` + `tv-service` (Node v20.12.2, Chrome 132 tabanlı WebAppManager). Bilgisayar yalnızca test günlüğünü almak için kullanıldı.

| Deneme | Sonuç |
|---|---|
| Web uygulamasından / servisten `luna://com.webos.service.capture/executeOneShot` | ❌ `Denied method call "executeOneShot" for category "/"` |
| `luna://com.webos.service.tv.capture` | ❌ Bu sürümde servis yok |
| Servisten SSAP, `127.0.0.1` / `localhost` (3000 ve 3001) | ❌ Kayıt mesajından sonra bağlantı `1008` ile kapanıyor |
| Servisten SSAP, **TV'nin kendi ağ adresi** (`wss://<TV IP>:3001`) | ✅ Bağlanıyor; ekranda izin sorusu çıkıyor |
| Aiowebostv'nin LG imzalı manifest'i | ❌ `403 Pairing rejected: blacklisted certificate detected` |
| Yalnızca `CONTROL_TV_SCREEN` içeren kısa imzasız izin listesi | ❌ Eşleşiyor ama `executeOneShot` için `401 insufficient permissions` |
| **Aiowebostv'nin tam izin listesi, imzasız** | ✅ `executeOneShot` çalışıyor |
| Uygulama öndeyken yakalama | ✅ 77 KB JPEG |
| **HDMI 1 öndeyken arka plandaki servisten yakalama** | ✅ PS5 görüntüsü geldi (6/6 kare), her biri ~280 ms |

Notlar:

- TV ağ adresi `luna://com.palm.connectionmanager/getStatus` ile bulunuyor.
- Yakalanan görüntüye TV'nin kendi ekran yazıları da giriyor (örn. "HDMI 1 / PS5" bilgisi). Bizim çizeceğimiz altyazı da yakalamaya girecektir; okuma sırasında kendi altyazımızı tekrar okumamak gerekiyor.
- Hangi iznin `401`'i çözdüğü henüz daraltılmadı.

## Model uyumluluğu (bilinenler)

| TV / webOS | Ekran görüntüsü | Kaynak |
|---|---|---|
| 55QNED7EB3C · webOS 26 (11.2.0) | ✅ HDMI dahil, ağ üzerinden ve TV'nin içinden | Kendi testimiz |
| 2023 G3 | ✅ HDMI dahil | Glowcast |
| C2 · webOS 9.2.2 (luna, root) | ❌ HDMI siyah | Glasshouse |
| webOS 6 ve sonrası (genel) | ⚠️ Sık sık `401 insufficient permissions` | kiwaili/home-assistant-lg-tv |
| webOS 4.x | ✅ (genişlik/yükseklik verilmeli) | kiwaili, Glowcast #221 |

## Benzer projeler

- **CouchSubs** (yorulmazsinan/couchsubs, AGPL-3.0): Aynı amaç. Okuma ve çeviri bilgisayarda yapılıyor, görüntü PS5 Remote Play ile alınıyor. TV yalnızca altyazıyı gösteriyor.
- **GameTranslator** (gitlab.com/sefflex/GameTranslator): CouchSubs'ın bir kopyası.
- **PicCap / hyperion-webos:** Root'lu TV'de HDMI dahil hızlı kare yakalama (ambiyans ışığı için).
- **Glowcast:** Root'suz ekran görüntüsü, ağ üzerinden.

## Kaynaklar

- https://forum.webostv.developer.lge.com/t/is-there-an-api-like-in-android-tv-get-screenshot-of-the-screen/1419
- https://forum.webostv.developer.lge.com/t/is-there-an-api-like-in-android-tv-to-overlay-ui-element-on-the-screen/1418
- https://github.com/nicohabets/glowcast/issues/185
- https://github.com/nicohabets/glowcast/pull/210
- https://github.com/nicohabets/glowcast/issues/221
- https://github.com/kiwaili/home-assistant-lg-tv
- https://gist.github.com/AkdM/c1571b2b0577f1bdb16011eb9b905803
- https://rorygallagher2024.github.io/glasshouse/development/TV-RESEARCH/
- https://github.com/webosbrew/hyperion-webos
- https://github.com/yorulmazsinan/couchsubs

## Test 3: Altyazıyı oyunun üstüne yazmak

`tv-overlay-test`: İngilizce altyazının yerine siyah kutu içinde Türkçe metin.

| Yöntem | Sonuç |
|---|---|
| `"defaultWindowType": "overlay"` + şeffaf sayfa, TV'nin kendi HDMI uygulaması önde | ❌ webOS 26 bunu yok sayıyor. Uygulama normal tam ekran açılıyor, oyun görüntüsü kayboluyor (siyah arka plan). |
| **HDMI uygulamanın içinde** (`<video><source type="service/webos-external" src="ext://hdmi:1">`) + üstte HTML altyazı | ✅ Oyun görüntüsü ve Türkçe altyazı birlikte görünüyor. TV'nin HDR rozeti açık. |

Henüz ölçülmedi: HDMI uygulamanın içindeyken tuş gecikmesi, 120 Hz / VRR ve Oyun Modu korunuyor mu?

### Kararma (stabilite)

- Test uygulaması kapanıp TV kendi HDMI ekranına dönünce görüntü **siyahta kaldı**. HDMI 1 öndeydi ve PS5 "bağlı" görünüyordu. HDMI 2'ye geçip geri dönmek ve TV'yi kapatıp açmak düzeltti.
- HDMI 1'e her dönüşte görüntü yaklaşık **6–10 saniye siyah** kalıyor (HDR yeniden kuruluyor), sonra geliyor.
- Kullanıcı ayrıca "ses gelince ekran gidiyor" dedi. Bu henüz tam anlaşılmadı.
- Tasarım kuralı: TV'nin HDMI ekranı ile bizim uygulama arasında **hiç geçiş yapılmamalı**. Uygulama bir kez açılınca oyun görüntüsü baştan sona uygulamanın içinde kalmalı; yalnızca altyazı değişmeli. Ekran yakalama da arka plan servisinden, geçiş yapmadan yapılmalı.

## Test 4: Okuma (OCR) ve çeviri

- **Yakalama kendi altyazımızı da görüyor.** Oyun uygulamanın içindeyken DISPLAY / SOURCE / VIDEO / SCREEN_WITH_SOURCE_VIDEO / SCALER / GRAPHIC yöntemlerinin hepsi aynı görüntüyü veriyor: üstte çizdiğimiz Türkçe kutu da karede var. Yöntem parametresi SSAP üzerinden etkisiz görünüyor.
  - Sonuç: Türkçe kutu İngilizceyi tamamen örterse yeni İngilizce satır görülemez. Kutu İngilizcenin hemen üstüne konmalı ya da başka bir çözüm bulunmalı.
- **Tesseract.js (cihaz üstü OCR, Node):** Kare başına ~80 ms, hızlı. Ama 960×540 karede okuma kalitesi yetersiz.
  - Tek satır: "Hi, this is Atewtic Blin. Gan | help you?"
  - İki satır: büyük ölçüde bozuk.
  - Beyaz yazı eşiği ve 3× büyütme biraz düzeltiyor, ama yetmiyor.
- **Çeviri:** Google'ın anahtarsız `translate_a` adresi bu ağdan "Sorry…" sayfası döndü (engelli). MyMemory anahtarsız çalışıyor ama günlük kotası düşük.
- **Öneri:** Altyazı bandını görsel okuyabilen bir yapay zekâ modeline göndermek. Örneğin Gemini Flash okumayı ve çeviriyi tek istekte yapar. Bunun için kullanıcının bir API anahtarı lazım.
- **Uygulama kapanınca kararma:** Uygulama kapanıp TV kendi HDMI ekranına dönünce görüntü siyahta kalıyor. HDMI 2'ye geçip HDMI 1'e dönmek düzeltiyor (~10 sn). Çözüm: oyun sırasında uygulamadan hiç çıkılmamalı. Çıkış gerekirse uygulama girişi kendisi sıfırlamalı.

## Sürüm 0.1: TV'de canlı Türkçe altyazı (çalışıyor)

`app/` + `service/` (`com.translateos.app`). Akış: SSAP ile ekran görüntüsü (saniyede ~2 kare) → altyazı bölgesinde "koyu kenarlı beyaz yazı" imzası → yeni yazıysa bölge kırpılır → `gemini-3.5-flash-lite` (okuma + çeviri tek istekte) → uygulama, oyunun üstüne Türkçe kutu çizer.

- **Değişim algılama:** Oransal imza farkı kullanılıyor. Aynı cümle ardışık karelerde 0,02–0,07 fark veriyor; farklı cümleler 0,33–0,87. Eşik 0,2. İlk sürümdeki mutlak fark (eşik 0,04) arka arkaya gelen cümleleri kaçırıyordu.
- **Gecikme (TV'den):** Gemini isteği 1,1–2,1 sn, yakalama ~0,3 sn.
- **Canlı test (GTA V, Atomic Blimp telefon konuşması):** Arka arkaya 4 cümle çevrildi.
- **Dayanıklılık:**
  - Servis nabız günlüğü tutuyor; yakalama 6 sn'de, çeviri 8 sn'de zaman aşımına düşüyor.
  - Uygulama servis düşerse yeniden abone oluyor.
  - Çıkışta TV'nin HDMI uygulamasını açıkça başlatıyor.
