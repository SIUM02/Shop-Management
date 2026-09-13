#!/usr/bin/env bash
#
# Builds the Windows 7 (32-bit) package.
#
# Separate from build-windows.sh because Windows 7 forces a different stack:
#   - Electron 22 is the last release that supports Windows 7, and it brings
#     its own Chromium, so the machine's frozen Chrome 109 stops mattering.
#   - Its Node is 16, which has no node:sqlite, so the data layer falls back
#     to SQLite compiled to WebAssembly. That has no compiled binary, which is
#     what makes a 32-bit build possible without hunting per-architecture
#     artifacts.
#
# Runs on macOS or Linux; it only downloads and rearranges files.
#
#   ./packaging/build-windows7.sh
#
set -euo pipefail

ELECTRON_VERSION="22.3.27"     # last Electron supporting Windows 7
ARCH="ia32"                    # 32-bit
PKG="electron-v${ELECTRON_VERSION}-win32-${ARCH}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$ROOT/build"
STAGE="$BUILD/ShopInventory-win7"
APPDIR="$STAGE/resources/app"
CACHE="$BUILD/.cache"

echo "==> Cleaning"
rm -rf "$STAGE"
mkdir -p "$STAGE" "$CACHE"

echo "==> Fetching Electron ${ELECTRON_VERSION} (win32-${ARCH})"
if [ ! -f "$CACHE/${PKG}.zip" ]; then
  curl -fL --progress-bar \
    "https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}/${PKG}.zip" \
    -o "$CACHE/${PKG}.zip"
else
  echo "    (cached)"
fi

echo "==> Unpacking Electron"
unzip -q "$CACHE/${PKG}.zip" -d "$STAGE"

# Electron falls back to this sample app when no app is bundled; removing it
# makes a packaging mistake fail loudly instead of opening Electron's demo.
rm -f "$STAGE/resources/default_app.asar"

echo "==> Naming the executable"
mv "$STAGE/electron.exe" "$STAGE/JanataInventory.exe"

echo "==> Copying the application"
mkdir -p "$APPDIR"
cp -R "$ROOT/src"    "$APPDIR/src"
cp -R "$ROOT/public" "$APPDIR/public"
cp    "$ROOT/electron/main.cjs" "$APPDIR/main.cjs"
mkdir -p "$APPDIR/icons"
cp "$ROOT/packaging/win/app.ico" "$APPDIR/icons/app.ico"
[ -f "$ROOT/packaging/win/README-বাংলা.txt" ] && cp "$ROOT/packaging/win/README-বাংলা.txt" "$STAGE/"

cp -R "$ROOT/node_modules" "$APPDIR/node_modules"
find "$APPDIR/node_modules" -name "*.md" -delete 2>/dev/null || true
find "$APPDIR/node_modules" -name ".DS_Store" -delete 2>/dev/null || true

# The manifest Electron reads. "type": "module" keeps src/*.js as ES modules;
# main.cjs stays CommonJS through its extension, which is what Electron 22
# needs for an entry point.
cat > "$APPDIR/package.json" <<'JSON'
{
  "name": "janata-inventory",
  "productName": "জনতা ইলেকট্রিক এন্ড ইলেকট্রনিক্স",
  "version": "1.0.0",
  "type": "module",
  "main": "main.cjs"
}
JSON

# Nothing from the developer's machine reaches the client.
rm -f "$APPDIR/.env" "$APPDIR/.env.local" "$APPDIR/.env.cloud.backup"
rm -rf "$APPDIR/data" "$APPDIR/backups"

echo "==> Verifying the bundle"
fail=0
for required in "JanataInventory.exe" "resources/app/main.cjs" "resources/app/src/app.js" \
                "resources/app/src/db-sqlite.js" "resources/app/public/index.html" \
                "resources/app/node_modules/express" \
                "resources/app/node_modules/node-sqlite3-wasm/dist/node-sqlite3-wasm.wasm"; do
  [ -e "$STAGE/$required" ] || { echo "    MISSING: $required"; fail=1; }
done
for forbidden in "resources/default_app.asar" "resources/app/.env" "resources/app/data"; do
  [ -e "$STAGE/$forbidden" ] && { echo "    MUST NOT SHIP: $forbidden"; fail=1; }
done
# The WASM engine is the whole reason this build works on 32-bit; if the app
# could reach for node:sqlite instead, it would fail only on the client's PC.
grep -q "node-sqlite3-wasm" "$APPDIR/src/db-sqlite.js" || {
  echo "    db-sqlite.js has no WASM fallback"; fail=1; }
[ "$fail" = 0 ] || { echo "==> Build FAILED"; exit 1; }

echo "==> Zipping"
( cd "$BUILD" && rm -f ShopInventory-win7-32bit.zip \
  && zip -qr ShopInventory-win7-32bit.zip ShopInventory-win7 )

echo
echo "Built:  $BUILD/ShopInventory-win7-32bit.zip"
du -sh "$BUILD/ShopInventory-win7-32bit.zip" | awk '{print "Size:   "$1}'
echo
echo "On the Windows 7 PC: unzip and run JanataInventory.exe"
echo "For a Setup.exe, compile packaging/win/installer-win7.iss with Inno Setup on Windows."
