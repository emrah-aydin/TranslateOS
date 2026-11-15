#!/bin/sh
# Kurulum programını tek dosya olarak paketler (Node.js "single executable application").
#   Mac:     dist/installer/TranslateOS-Kurulum-Mac.zip  (Apple Silicon + Intel, tek uygulama)
#   Windows: dist/installer/TranslateOS-Kurulum.exe
# Önce yayın paketi üretilmiş olmalı: sh tools/build-release.sh
set -e
cd "$(dirname "$0")"
NODE_V=v22.18.0
FUSE=NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
B=build
OUT=../dist/installer
CACHE=.cache/$NODE_V
mkdir -p "$B" "$OUT" "$CACHE"

[ "$(node -v)" = "$NODE_V" ] || { echo "Bu betik Node $NODE_V ister (şu an $(node -v))." >&2; exit 1; }
IPK=$(ls ../dist/release/*.ipk 2>/dev/null | tail -1)
[ -n "$IPK" ] || { echo "Önce: sh tools/build-release.sh" >&2; exit 1; }
[ -d node_modules ] || npm install --no-audit --no-fund

# 1) Tek JS dosyası + gömülü .ipk
npx esbuild main.js --bundle --platform=node --target=node22 --loader:.html=text \
  --external:cpu-features --external:*.node --outfile="$B/bundle.js" --log-level=warning
cp "$IPK" "$B/app.ipk"
cat > "$B/sea-config.json" <<JSON
{ "main": "bundle.js", "output": "sea.blob", "disableExperimentalSEAWarning": true, "useCodeCache": false,
  "assets": { "app.ipk": "app.ipk" } }
JSON
(cd "$B" && node --experimental-sea-config sea-config.json)

# 2) Resmî Node ikili dosyalarını indir ve SHA256 ile doğrula
fetch() { [ -f "$CACHE/$1" ] || curl -fsSL "https://nodejs.org/dist/$NODE_V/$1" -o "$CACHE/$1"; }
fetch SHASUMS256.txt
for f in node-$NODE_V-darwin-arm64.tar.gz node-$NODE_V-darwin-x64.tar.gz win-x64/node.exe; do
  fetch "$f" 2>/dev/null || { mkdir -p "$CACHE/$(dirname $f)"; fetch "$f"; }
  want=$(grep " $f\$" "$CACHE/SHASUMS256.txt" | cut -d' ' -f1)
  got=$(shasum -a 256 "$CACHE/$f" | cut -d' ' -f1)
  [ "$want" = "$got" ] || { echo "SHA256 uyuşmuyor: $f" >&2; rm -f "$CACHE/$f"; exit 1; }
done

# 3) Mac: iki mimari → tek evrensel uygulama
for a in arm64 x64; do
  tar -xzf "$CACHE/node-$NODE_V-darwin-$a.tar.gz" -C "$B" "node-$NODE_V-darwin-$a/bin/node"
  cp "$B/node-$NODE_V-darwin-$a/bin/node" "$B/mac-$a"
  codesign --remove-signature "$B/mac-$a"
  npx postject "$B/mac-$a" NODE_SEA_BLOB "$B/sea.blob" --sentinel-fuse $FUSE --macho-segment-name NODE_SEA >/dev/null
done
APP="$B/TranslateOS Kurulum.app"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS"
lipo -create "$B/mac-arm64" "$B/mac-x64" -output "$APP/Contents/MacOS/translateos-kurulum"
# Uygulama ikonu
mkdir -p "$APP/Contents/Resources" "$B/icon.iconset"
for sz in 16 32 128 256 512; do
  sips -z $sz $sz logo-1024.png --out "$B/icon.iconset/icon_${sz}x${sz}.png" >/dev/null
  sips -z $((sz*2)) $((sz*2)) logo-1024.png --out "$B/icon.iconset/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$B/icon.iconset" -o "$APP/Contents/Resources/icon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>TranslateOS Kurulum</string>
  <key>CFBundleIdentifier</key><string>com.translateos.installer</string>
  <key>CFBundleExecutable</key><string>translateos-kurulum</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
rm -f "$OUT/TranslateOS-Kurulum-Mac.zip"
ditto -c -k --norsrc --noextattr --keepParent "$APP" "$OUT/TranslateOS-Kurulum-Mac.zip"

# 4) Windows
cp "$CACHE/win-x64/node.exe" "$OUT/TranslateOS-Kurulum.exe"
npx postject "$OUT/TranslateOS-Kurulum.exe" NODE_SEA_BLOB "$B/sea.blob" --sentinel-fuse $FUSE >/dev/null

ls -lh "$OUT"
