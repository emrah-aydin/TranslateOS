-- Ortak çeviri hafızası: normalleştirilmiş İngilizce → Türkçe. İlk gelen çeviri kalır (herkes aynı Türkçeyi görür).
CREATE TABLE IF NOT EXISTS lines (
  k TEXT PRIMARY KEY,          -- normalleştirilmiş İngilizce (küçük harf, noktalama yok)
  en TEXT NOT NULL,
  tr TEXT NOT NULL,
  device TEXT,                 -- ekleyen TV (kötüye kullanımda toplu silmek için)
  seen INTEGER DEFAULT 1,      -- kaç kez eklenmeye çalışıldı (popülerlik)
  confirm INTEGER DEFAULT 1,   -- aynı cümleyi okuyan farklı TV sayısı (MIN_CONFIRM ile herkese açılır)
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lines_updated ON lines(updated);
CREATE INDEX IF NOT EXISTS lines_device ON lines(device);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  created INTEGER NOT NULL,
  day TEXT,                    -- günlük sınır için gün (YYYY-MM-DD)
  adds INTEGER DEFAULT 0,      -- o gün eklenen cümle
  banned INTEGER DEFAULT 0,
  gday TEXT,                   -- anahtarsız mod: günlük çeviri sayacı
  gcount INTEGER DEFAULT 0
);

-- Kayıt sınırı: IP saklanmaz, günlük tuzlu özet (HMAC) tutulur ve ertesi gün silinir.
CREATE TABLE IF NOT EXISTS regs (
  k TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  n INTEGER DEFAULT 0
);

-- Anahtarsız mod: günlük toplam istek sayısı (fatura tavanı için)
CREATE TABLE IF NOT EXISTS usage (
  day TEXT PRIMARY KEY,
  n INTEGER DEFAULT 0
);
