#!/bin/bash
# Instala o actualiza DELTA Mac en /Applications (se corre con un solo comando desde la Terminal).
set -euo pipefail
URL="https://github.com/accepticontabilidad-png/DELTA-STUDIO/releases/download/delta-mac/DELTA-Mac.zip"
TMP=$(mktemp -d)
echo "Descargando DELTA Mac…"
curl -fsSL "$URL" -o "$TMP/DELTA-Mac.zip"
osascript -e 'quit app "DELTA Mac"' 2>/dev/null || true
rm -rf "/Applications/DELTA Mac.app"
ditto -x -k "$TMP/DELTA-Mac.zip" /Applications
xattr -dr com.apple.quarantine "/Applications/DELTA Mac.app" 2>/dev/null || true
rm -rf "$TMP"
open "/Applications/DELTA Mac.app"
echo "Listo. Busque la Δ arriba, junto al reloj."
