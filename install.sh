#!/bin/sh
# TranslateOS kurulum programını Mac'e indirip açar.
# Kullanım (Terminal):
#   curl -fsSL https://raw.githubusercontent.com/emrah-aydin/TranslateOS/main/install.sh | sh
set -e

if [ "$(uname)" != "Darwin" ]; then
  echo "Bu komut Mac içindir. Windows'ta TranslateOS-Kurulum.exe dosyasını kullan:"
  echo "https://github.com/emrah-aydin/TranslateOS/releases/latest"
  exit 1
fi

URL="https://github.com/emrah-aydin/TranslateOS/releases/latest/download/TranslateOS-Kurulum-Mac.zip"
DIR="$(mktemp -d)"

echo ""
echo "  TranslateOS kurulum programı indiriliyor..."
curl -fL --progress-bar "$URL" -o "$DIR/kurulum.zip"
ditto -x -k "$DIR/kurulum.zip" "$DIR"
rm -f "$DIR/kurulum.zip"

APP="$DIR/TranslateOS.app"
[ -d "$APP" ] || APP="$DIR/TranslateOS Kurulum.app"
open "$APP"
echo "  Kurulum sayfası tarayıcında açılıyor. Mac yerel ağ izni sorarsa \"İzin Ver\"e bas."
echo "  TranslateOS, açıkken Dock'ta görünür; kapatmak için Dock'ta sağ tık › Çık."
echo ""
