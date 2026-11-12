# TranslateOS

> **Durum: araştırma / prototip.** Henüz kullanıma hazır değil.

LG webOS TV'de çalışan bir altyazı çevirmeni. HDMI'dan gelen oyun görüntüsündeki İngilizce altyazıyı okur, yapay zekâ ile Türkçeye çevirir ve oyunun üstünde gösterir. Hedef, bilgisayar, kamera ya da capture card olmadan **yalnızca TV'de** çalışması.

Araştırma bulguları ve test sonuçları: [docs/ARASTIRMA.md](docs/ARASTIRMA.md)

## Klasörler

| Klasör | İçerik |
|---|---|
| `tv-app/` | TV'deki web uygulaması. Şu an öz-test arayüzü. |
| `tv-service/` | Uygulamanın arka plan JS servisi (ekran yakalama denemeleri) |
| `tools/` | Bilgisayardan TV'yi test eden Python araçları |
| `docs/` | Araştırma notları |
| `local/` | **Git dışı:** TV adresi, eşleşme anahtarı, ekran görüntüleri |

## Geliştirme

```bash
npm run setup                      # ares-cli ve servis bağımlılıkları
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.txt
cp tv-app/debug-config.example.js tv-app/debug-config.js   # isteğe bağlı: sonuç alıcısının adresi
```

TV'ye kurmak için TV'de **Developer Mode** açık olmalı ve cihaz `tv` adıyla tanıtılmalı (`ares-setup-device`):

```bash
npm run package && npm run install-tv && npm run launch-tv
```

Bilgisayardan ekran görüntüsü testi (TV adresi `local/config.json` içinde ya da `TV_HOST` ortam değişkeninde):

```bash
.venv/bin/python tools/capture_test.py
```

## Üçüncü taraf

- `service/registration.json` ve `tv-service/registration.json`: TV eşleşme bildirimi, [aiowebostv](https://github.com/home-assistant-libs/aiowebostv) projesinden alındı (Apache-2.0).
- Çeviri: Google Gemini API. Anahtar repoda tutulmaz; `service/config.local.json` dosyasında durur (git dışı).
