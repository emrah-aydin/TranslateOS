# TranslateOS'a katkıda bulunma

TranslateOS'u geliştirmek istediğin için teşekkürler!

## Nasıl katkı verebilirsin?

- **TV testi:** TranslateOS'u kendi LG TV'nde dene. Model ve webOS sürümüyle birlikte sonucu bir issue'da paylaş.
- **Oyun testi:** Altyazılı bir PS5 oyununda dene. Neyin iyi, neyin kötü çalıştığını yaz.
- **Çeviri kalitesi:** Yanlış veya garip çevirileri ekran görüntüsüyle bildir.
- **Kod:** Hata düzeltmeleri, hız iyileştirmeleri ve yeni özellikler.

## Kod katkısı

1. Repoyu fork'la ve yeni bir dal aç: `git checkout -b ozellik/kisa-aciklama`
2. Değişikliğini yap. Mümkünse TV'de dene.
3. Commit mesajında ne yaptığını ve nedenini kısaca yaz.
4. Pull request aç; ne değiştiğini ve nasıl test ettiğini anlat.

## Kurallar

- **Gizli bilgi gönderme.** API anahtarı, TV eşleşme anahtarı, IP adresi ve kişisel bilgi commit'e girmez. `local/`, `service/config.local.json` ve `tv-app/debug-config.js` git dışındadır; öyle kalsın.
- **Yorum ve metinler Türkçe olsun.** Kod yorumları ve arayüz metinleri Türkçedir.
- **Stabilite önce gelir.** Oyun görüntüsünün kararmasına ya da donmasına yol açabilecek değişiklikleri TV'de mutlaka dene.

## Lisans

Gönderdiğin her katkı, projenin lisansı olan [AGPL-3.0](LICENSE) altında yayınlanır.
