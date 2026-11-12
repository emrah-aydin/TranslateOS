# TranslateOS: PS5 Oyunlarına TV'de Anlık Türkçe Altyazı (GTA 5 · GTA 6)

**TranslateOS**, LG webOS akıllı televizyonda çalışan, yapay zekâ destekli bir **gerçek zamanlı oyun altyazı çevirmenidir**. PlayStation 5'teki İngilizce oyunların altyazısını ekrandan okur, **Türkçeye çevirir** ve İngilizce altyazının tam üstüne yazar.

Bilgisayar, kamera, capture card ya da başka bir cihaz gerekmez. PS5 HDMI ile TV'ye bağlı kalır, her şey **televizyonun içinde** çalışır.

> GTA 5 Türkçe altyazı · GTA 6 Türkçe yama · PS5 Türkçe çeviri · LG TV oyun çevirmeni · yapay zekâ ile anlık altyazı

![GTA 5'te TranslateOS ile Türkçe altyazı: tekne görevi](docs/screenshots/gta5-turkce-altyazi-tekne.jpg)

<p align="center">
  <img src="docs/screenshots/gta5-turkce-altyazi-otoyol.jpg" width="49%" alt="GTA 5 Türkçe altyazı: otoyolda takip">
  <img src="docs/screenshots/gta5-turkce-altyazi-kopru.jpg" width="49%" alt="GTA 5 Türkçe altyazı: köprüde konuşma">
</p>
<p align="center">
  <img src="docs/screenshots/gta5-turkce-altyazi-sokak.jpg" width="49%" alt="GTA 5 Türkçe altyazı: sokakta görev">
  <img src="docs/screenshots/gta5-turkce-altyazi-1.jpg" width="49%" alt="GTA 5 Türkçe altyazı: gece telefon görüşmesi">
</p>

*Ekran görüntüleri doğrudan TV'den alınmıştır: PS5'te GTA V, LG QNED TV, TranslateOS açık. Türkçe altyazı, oyunun İngilizce altyazısının tam üstüne yazılıyor.*

### Canlı test sonucu

GTA V'te 10 dakika kesintisiz oynanıp TV'den alınan 570 kare tek tek incelendi:

| Ölçüm | Sonuç |
|---|---|
| Ekrana gelen altyazı | 47 |
| Türkçesi gösterilen | **47 / 47** |
| Boş siyah kutu / hata | 0 / 0 |
| Çeviri süresi (ortanca) | 1,3 sn |

---

## Neler yapıyor?

- 🎮 **Oyun TV'de, altyazı Türkçe.** PS5'te her zamanki gibi oynarsın; İngilizce altyazının yerinde Türkçesi görünür.
- 🧠 **Yapay zekâ ile okuma ve çeviri.** Altyazı bölgesi Google Gemini'ye gider; model tek istekte hem okur hem çevirir.
- 🔥 **Sansürsüz, doğal çeviri.** Sokak ağzı, argo ve küfür yumuşatılmadan, oyundaki sertliğiyle Türkçeye aktarılır. Çeviri yalnızca Türkçedir.
- ⚡ **Hızlı.** Altyazı göründükten yaklaşık 1–2 saniye sonra Türkçesi gelir. Aynı cümle ikinci kez çevrilmez, hafızadan gelir.
- 🕶️ **Sadece Türkçe görünür.** Türkçe altyazı İngilizcenin üstüne oturur. Yeni cümle geldiğinde eski Türkçe yerinde kalır; kutu bir an hafif açılıp yeni İngilizceyi okur, sonra yeni Türkçe yerine geçer. Boş siyah kutu çıkmaz.
- 🗣️ **Hızlı konuşmada da eksiksiz.** Cümleler çeviriden hızlı akarsa Türkçe altyazılar biraz geriden ama sırayla, hiçbiri atlanmadan gelir.
- ⏱️ **Okunabilir süre.** Her Türkçe altyazı, uzunluğuna göre en az 2,5–7 saniye ekranda kalır.
- 💾 **Cümle hafızası.** Çevrilen her cümle TV'de saklanır; aynı cümle her zaman aynı Türkçeyle çıkar.
- 📺 **Kumanda ile kontrol.** Kırmızı: altyazı aç/kapat · Sarı: Türkçe İngilizcenin üstünde / yerine · Yeşil: menü · Geri: çıkış.
- 😴 **TV uyumaz.** Oyun sırasında ekran koruyucu ve uyku modu devreye girmez.

## TV menüsü

Yeşil tuşla açılır, 10 saniyede kendiliğinden kapanır: altyazı durumu, Türkçenin yeri, çevrilen ve hafızadaki cümle sayısı.

![TranslateOS TV menüsü](docs/screenshots/translateos-menu.jpg)

## GTA 5 ve GTA 6

- **GTA 5 (GTA V):** PS5'te test edildi. Telefon görüşmeleri, görev konuşmaları ve çatışma sırasındaki diyaloglar çevriliyor.
- **GTA 6 (GTA VI):** TranslateOS oyuna özel değildir; ekranda İngilizce altyazı gösteren her oyunda çalışacak şekilde tasarlandı. GTA 6 çıktığında hedefimiz ilk günden Türkçe altyazıyla oynatmak.
- Altyazısı olan diğer PS5 oyunları da çalışmalı. Denediğin oyunları [bize bildir](../../issues).

## Nasıl çalışıyor?

```
PS5 ──HDMI──► LG TV ──► TranslateOS uygulaması (oyun görüntüsü + Türkçe altyazı katmanı)
                         │
                         └─► Arka plan servisi: ekran görüntüsü (saniyede ~2–3 kare)
                               → altyazı bölgesi değişti mi?
                               → Gemini: oku + Türkçeye çevir
                               → altyazıyı İngilizcenin üstüne yaz
```

Teknik ayrıntılar, ölçümler ve araştırma notları: [docs/ARASTIRMA.md](docs/ARASTIRMA.md)

## Desteklenen TV'ler

| TV | webOS | Durum |
|---|---|---|
| LG 55QNED7EB3C | webOS 26 (11.2.0) | ✅ Test edildi, çalışıyor |
| Diğer LG webOS TV'ler | 23 / 24 / 25 | 🟡 Henüz denenmedi |
| Eski LG webOS TV'ler | 4.x – 22 | 🟡 Henüz denenmedi |

Senin TV'n listede yoksa dene ve sonucu [issue olarak bildir](../../issues). Liste senin bildirimlerinle büyüyecek.

## Kurulum (geliştirici sürümü)

> Şu an kurulum geliştirici modu gerektiriyor. Herkesin tek tuşla kurabileceği kolay kurulum yol haritasında.

1. TV'de **LG Content Store**'dan **Developer Mode** uygulamasını kur, LG geliştirici hesabınla giriş yap, Dev Mode'u ve Key Server'ı aç.
2. Bilgisayarda:
   ```bash
   npm run setup
   ```
3. Ücretsiz bir **Gemini API anahtarı** al: [aistudio.google.com/apikey](https://aistudio.google.com/apikey). `service/config.local.json` dosyasına yaz:
   ```json
   { "geminiKey": "ANAHTARIN" }
   ```
4. TV'yi tanıt (`ares-setup-device`, cihaz adı `tv`) ve kur:
   ```bash
   npm run package && npm run install-tv && npm run launch-tv
   ```
5. İlk açılışta TV'de çıkan izin sorusunu onayla. Bu kadar.

## Yol haritası

- [ ] Tek tuşla kurulum (Homebrew Channel) ve resimli Türkçe kurulum rehberi
- [ ] API anahtarını TV'de QR kodla girme
- [ ] Ortak çeviri hafızası: bir kişinin çevirdiği cümle herkese anında ve ücretsiz gelsin
- [ ] Gecikmeyi 1 saniyenin altına indirmek
- [ ] Daha fazla TV modeli ve oyun testi

## Katkıda bulun ⭐

TranslateOS **geliştirmeye açık**. Kod, test, çeviri kalitesi, yeni TV modeli, yeni oyun; her katkı değerli.

- Projeyi beğendiysen **⭐ yıldız ver**. Daha çok kişiye ulaşmasını sağlar.
- Hata ya da öneri için [issue aç](../../issues).
- Kod katkısı için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını oku ve pull request gönder.

## Geliştirici

**Emrah AYDIN** · Instagram: [@emrahaydin.es](https://instagram.com/emrahaydin.es)

## Lisans

Copyright (C) 2026 Emrah AYDIN

TranslateOS, [GNU Affero Genel Kamu Lisansı v3.0 (AGPL-3.0)](LICENSE) ile yayınlanmıştır. Kodu kullanabilir, değiştirebilir ve paylaşabilirsin. Değiştirilmiş sürümü dağıtan ya da servis olarak sunan herkes kaynak kodunu aynı lisansla açmak ve bu telif bildirimini korumak zorundadır.

### Üçüncü taraf

- `service/registration.json`, `tv-service/registration.json`: TV eşleşme bildirimi, [aiowebostv](https://github.com/home-assistant-libs/aiowebostv) projesinden (Apache-2.0).
- [@jsquash/jpeg](https://github.com/jamsinclair/jSquash) (Apache-2.0), [jpeg-js](https://github.com/jpeg-js/jpeg-js) (BSD-3-Clause), [ws](https://github.com/websockets/ws) (MIT).
- Çeviri: Google Gemini API. Anahtar repoda tutulmaz.

---

TranslateOS bağımsız bir projedir. Rockstar Games, Take-Two Interactive, Sony Interactive Entertainment veya LG Electronics ile bağlantısı yoktur. GTA, Grand Theft Auto, PlayStation, PS5, LG ve webOS ilgili sahiplerinin ticari markalarıdır. Ekran görüntüleri yalnızca tanıtım amaçlıdır.

---

## English

**TranslateOS** is an AI-powered, real-time game subtitle translator that runs entirely on an LG webOS smart TV. It reads English subtitles from the PS5 (HDMI) picture, translates them into Turkish with Google Gemini, and draws the Turkish subtitle over the original one. No PC, camera or capture card is needed. Tested with GTA 5 on PS5, and built to work with GTA 6 and any game that shows subtitles. Contributions and ⭐ stars are welcome. Licensed under AGPL-3.0. Author: Emrah AYDIN ([@emrahaydin.es](https://instagram.com/emrahaydin.es)).
