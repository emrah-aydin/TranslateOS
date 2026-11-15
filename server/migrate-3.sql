-- 3. sürüm: ortak şekil hafızası
CREATE TABLE IF NOT EXISTS fps (k TEXT NOT NULL, w INTEGER NOT NULL, h INTEGER NOT NULL, b TEXT NOT NULL, device TEXT, created INTEGER NOT NULL, PRIMARY KEY (k, w, h));
CREATE INDEX IF NOT EXISTS fps_created ON fps(created);
