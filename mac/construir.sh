#!/bin/bash
# Arma "DELTA Mac.app" (Intel y Apple Silicon) y la deja en mac/salida/DELTA-Mac.zip. Corre en una Mac con Xcode.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf salida && mkdir -p salida
APP="salida/DELTA Mac.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
for arq in arm64 x86_64; do
  swiftc -O -parse-as-library -target "$arq-apple-macos13.0" \
    -framework AppKit -framework AVFoundation -framework ServiceManagement -framework Carbon \
    Fuentes/*.swift -o "salida/delta-$arq"
done
lipo -create salida/delta-arm64 salida/delta-x86_64 -output "$APP/Contents/MacOS/DELTA Mac"
cp Info.plist "$APP/Contents/Info.plist"
# Icono a partir del de la app web
ICONSET=salida/Icono.iconset
mkdir -p "$ICONSET"
for t in 16 32 128 256 512; do
  sips -z $t $t ../public/icons/icono-512.png --out "$ICONSET/icon_${t}x${t}.png" >/dev/null
  d=$((t * 2)); [ $d -le 512 ] && sips -z $d $d ../public/icons/icono-512.png --out "$ICONSET/icon_${t}x${t}@2x.png" >/dev/null
done
cp ../public/icons/icono-512.png "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/Icono.icns" || echo "sin icono"
codesign --force --deep --sign - "$APP"
codesign --verify --verbose "$APP"
(cd salida && ditto -c -k --keepParent "DELTA Mac.app" DELTA-Mac.zip)
echo "Listo: mac/salida/DELTA-Mac.zip"
