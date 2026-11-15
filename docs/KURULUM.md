# TranslateOS kurulum rehberi

LG webOS TV'ye TranslateOS'u kurmak yaklaşık **10 dakika** sürer. Bir kez yapılır.

**Gerekenler:**
- LG webOS akıllı TV (test edilen: LG 55QNED7EB3C, webOS 26). Diğer modeller için [uyumluluk listesine](../README.md#desteklenen-tvler) bak.
- PS5 (ya da altyazılı oyun gösteren herhangi bir cihaz), TV'ye HDMI ile bağlı.
- Bilgisayar (Windows ya da Mac). Sadece kurulum için, bir kez; sonra gerekmez.
- Telefon. Sadece Gemini anahtarını girmek için.
- TV, bilgisayar ve telefon **aynı Wi-Fi** ağında olmalı.

---

## 1. LG geliştirici hesabı (ücretsiz)

1. [webostv.developer.lge.com](https://webostv.developer.lge.com) adresine gir.
2. Sağ üstte **Sign In** › LG hesabınla giriş yap. Hesabın yoksa **Create Account** ile aç.

## 2. TV'de Developer Mode'u aç

1. TV'de **Apps** (LG Content Store) uygulamasını aç, **Developer Mode**'u ara ve kur.
2. Developer Mode'u aç, 1. adımdaki hesapla giriş yap.
3. **Dev Mode Status**'u **ON** yap. TV yeniden başlar.
4. Developer Mode'u tekrar aç, **Key Server**'ı **ON** yap.
5. Ekranda yazan **IP adresini** ve **Passphrase**'i (6 karakter) bir kenara not et.

> Developer Mode süreli çalışır. TranslateOS bu süreyi her açılışta kontrol eder ve azaldığında **kendiliğinden uzatır**. 

## 3. Kurulum programını aç

**Mac (önerilen, uyarısız):** **Terminal** uygulamasını aç (Spotlight'ta "Terminal" yaz), şu satırı yapıştır ve Enter'a bas:

```bash
curl -fsSL https://raw.githubusercontent.com/emrah-aydin/TranslateOS/main/install.sh | sh
```

Komut kurulum programını indirip kendisi açar; Mac "doğrulanamadı" uyarısı göstermez.

**Windows:** [Son sürüm sayfasından](https://github.com/emrah-aydin/TranslateOS/releases/latest) `TranslateOS-Kurulum.exe` dosyasını indir.

**Mac, Terminal'siz:** Aynı sayfadan `TranslateOS-Kurulum-Mac.zip` dosyasını da indirebilirsin (aşağıdaki Mac uyarısını geçmen gerekir).

## 4. Programı aç, kodu yaz

1. Programı aç (Terminal komutuyla açtıysan zaten açılmıştır). Tarayıcında bir kurulum sayfası açılır.
   - **Windows:** "Windows bilgisayarınızı korudu" uyarısı çıkarsa **Ek bilgi** › **Yine de çalıştır**'a bas.
   - **Mac:** "yerel ağdaki aygıtları bulmak istiyor" diye sorarsa **İzin Ver**'e bas; bu izin olmadan program TV'yi göremez. Zip ile indirdiysen önce "doğrulanamadı" uyarısı çıkar: **Bitti**'ye bas, **Sistem Ayarları › Gizlilik ve Güvenlik**'e gir, en altta **Yine de Aç**'a bas.
2. Sayfa ağdaki LG TV'ni kendisi bulur. Bulamazsa TV'nin IP adresini elle yaz.
3. Developer Mode uygulamasındaki **Passphrase**'i (6 karakter) yaz, **TranslateOS'u kur**'a bas.
4. Bir dakikadan kısa sürede kurulum biter ve TranslateOS TV'nde kendiliğinden açılır.

> Program TranslateOS'un en son sürümünü GitHub'dan indirip kurar. Güncellemek için programı yeniden çalıştırman yeterli; çeviri hafızan ve anahtarın silinmez.

## 5. Gemini anahtarını telefonla gir

1. TranslateOS açılınca ekranda bir QR kod çıkar.

   ![TranslateOS kurulum ekranı](screenshots/translateos-kurulum-qr.jpg)

2. QR kodu telefonunun kamerasıyla okut.
3. Açılan sayfadaki bağlantıdan [aistudio.google.com/apikey](https://aistudio.google.com/apikey) adresine git, Google hesabınla giriş yap, **Create API key** ile ücretsiz anahtarını al ve kopyala.
4. Kurulum sayfasına geri dön, anahtarı yapıştır ve **TV'ye kaydet**'e bas.
5. TV'de "Anahtar kaydedildi" yazar. Anahtar sadece TV'nde saklanır.

## 6. İlk açılışta izin

İlk açılışta TV "bu uygulamaya izin verilsin mi?" diye sorar. **İzin ver**'e bas. TranslateOS, altyazıyı okuyabilmek için TV'nin ekran görüntüsüne ihtiyaç duyar. Bu soru sadece bir kez çıkar.

Bitti. PS5'te altyazılı bir oyun aç; İngilizce altyazılar Türkçe olarak oyunun üstünde görünür.

---

## Kumanda

| Tuş | Ne yapar |
|---|---|
| OK ya da 🟢 Yeşil | Menü |
| 🔵 Mavi | Gemini anahtarını değiştir (QR ekranı) |
| Geri | TranslateOS'u kapat, normal TV'ye dön |

## Sorun giderme

- **QR kodu okutunca sayfa açılmıyor:** Telefon ve TV aynı Wi-Fi ağında olmalı. Misafir ağı ya da mobil veri çalışmaz.
- **"Bu TV ekran görüntüsü vermiyor" yazıyor:** TV modelin henüz desteklenmiyor olabilir. Lütfen modelini ve webOS sürümünü (Ayarlar › Genel › Cihaz › TV Bilgisi) [GitHub'da bildir](https://github.com/emrah-aydin/TranslateOS/issues).
- **Kurulum programı TV'yi bulamıyor:** TV ile bilgisayar aynı Wi-Fi ağında mı? TV'nin IP adresini Developer Mode uygulamasından okuyup sayfaya elle yaz. Mac'te yerel ağ iznini yanlışlıkla reddettiysen: **Sistem Ayarları › Gizlilik ve Güvenlik › Yerel Ağ** bölümünde **TranslateOS Kurulum**'u aç, programı kapatıp yeniden aç.
- **"Kod yanlış" diyor:** Developer Mode uygulamasındaki Passphrase'i kontrol et. Key Server'ı kapatıp açınca kod değişebilir.
- **Uygulama listeden kayboldu:** Developer Mode kapanmış olabilir. 2. adımı tekrarla, sonra kurulum programını yeniden çalıştır.
- **Görüntü siyah kaldı:** Kumandadan giriş tuşuna (Input) basıp HDMI girişini yeniden seç.

## Gelişmiş: kurulum programı olmadan

Kurulum programını kullanmak istemezsen `.ipk` dosyasını [son sürümden](https://github.com/emrah-aydin/TranslateOS/releases/latest) indirip ücretsiz [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases) ile de kurabilirsin: **Add Device** (TV'nin IP adresi ve Passphrase) › **Apps** › `.ipk` dosyasını sürükle.

## Kaldırma

TV'nin ana ekranında TranslateOS'un üstüne gel, **OK** tuşuna basılı tut ve **Kaldır**'ı seç. Bu yol TV menüsünde de yazar.

## Ortak hafıza ve gizlilik

TranslateOS çevirdiği cümleleri (İngilizce ve Türkçesi) ortak hafıza sunucusuna gönderir ve diğer oyuncuların çevirilerini indirir. Böylece aynı cümle herkese anında gelir. Sunucuya ekran görüntüsü gitmez; isim, e-posta ya da IP adresi saklanmaz, TV sadece rastgele bir kimlik numarası alır. Gemini anahtarın sadece TV'nde durur.

