#!/bin/sh
# Yayın paketi: anahtar, kişisel ayar ve geliştirme dosyaları OLMADAN .ipk üretir (dist/release/).
set -e
cd "$(dirname "$0")/.."
OUT=dist/release
SRC=dist/release-src
rm -rf dist/release-src && mkdir -p dist/release-src dist/release
cp -R app "$SRC/app"
cp -R service "$SRC/service"
# Kişisel / geliştirme dosyalarını çıkar
for f in config.local.json bench.jpg memory.json fp.json settings.json memory.json.tmp fp.json.tmp settings.json.tmp; do rm -f "$SRC/service/$f"; done
rm -f "$SRC/app/debug-config.js"
# Güvenlik: pakette anahtar kalmadığını doğrula
if grep -rqE "AQ\.[A-Za-z0-9_-]{20}|AIza[0-9A-Za-z_-]{20}|gsk_|sk-ant-" "$SRC"; then echo "HATA: pakette anahtar var" >&2; exit 1; fi
npx ares-package "$SRC/app" "$SRC/service" -o "$OUT"
ls -la "$OUT"
