#!/usr/bin/env bash
#
# Builds the Windows bundle: a self-contained folder the client can run with
# no Node, no Postgres and no internet.
#
# Runs on macOS or Linux — it only downloads and rearranges files, so the
# Windows package can be produced without a Windows machine. The resulting
# Setup.exe, if you want one, still has to be compiled on Windows; see
# packaging/win/installer.iss.
#
#   ./packaging/build-windows.sh
#
set -euo pipefail

NODE_VERSION="24.21.0"          # LTS. node:sqlite is built in and unflagged.
NODE_PKG="node-v${NODE_VERSION}-win-x64"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="$ROOT/build"
STAGE="$BUILD/ShopInventory"
CACHE="$BUILD/.cache"

echo "==> Cleaning"
rm -rf "$STAGE"
mkdir -p "$STAGE" "$CACHE"

echo "==> Fetching Node ${NODE_VERSION} for Windows"
if [ ! -f "$CACHE/${NODE_PKG}.zip" ]; then
  curl -fL --progress-bar \
    "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_PKG}.zip" \
    -o "$CACHE/${NODE_PKG}.zip"
else
  echo "    (cached)"
fi

echo "==> Unpacking the Node runtime"
rm -rf "$CACHE/$NODE_PKG"
unzip -q "$CACHE/${NODE_PKG}.zip" -d "$CACHE"

mkdir -p "$STAGE/node"
# node.exe is the whole runtime on Windows; the rest of the archive is npm and
# documentation the shop will never run, and it triples the download.
cp "$CACHE/$NODE_PKG/node.exe" "$STAGE/node/node.exe"

echo "==> Copying the application"
cp -R "$ROOT/src"    "$STAGE/src"
cp -R "$ROOT/public" "$STAGE/public"
cp    "$ROOT/package.json" "$STAGE/package.json"
cp    "$ROOT/packaging/launch.mjs" "$STAGE/launch.mjs"
cp    "$ROOT/packaging/stop.mjs"   "$STAGE/stop.mjs"

# Dependencies, without the dev tooling or anything already in the repo.
cp -R "$ROOT/node_modules" "$STAGE/node_modules"
find "$STAGE/node_modules" -name "*.md" -delete 2>/dev/null || true
find "$STAGE/node_modules" -name ".DS_Store" -delete 2>/dev/null || true

echo "==> Adding the Windows launchers"
cp "$ROOT/packaging/win/Shop Inventory.vbs" "$STAGE/"
cp "$ROOT/packaging/win/Start with console (troubleshooting).bat" "$STAGE/"
cp "$ROOT/packaging/win/Stop Shop.bat" "$STAGE/"
[ -f "$ROOT/packaging/win/README-বাংলা.txt" ] && cp "$ROOT/packaging/win/README-বাংলা.txt" "$STAGE/"
mkdir -p "$STAGE/icons"
cp "$ROOT/public/icons/icon-512.png" "$STAGE/icons/icon-512.png"
[ -f "$ROOT/packaging/win/app.ico" ] && cp "$ROOT/packaging/win/app.ico" "$STAGE/icons/app.ico"

# Nothing from the developer's machine goes to the client: .env holds the
# cloud credentials, and data/ holds this machine's shop.
rm -f "$STAGE/.env" "$STAGE/.env.local" "$STAGE/.env.cloud.backup"
rm -rf "$STAGE/data"

echo "==> Verifying the bundle"
fail=0
for required in "node/node.exe" "launch.mjs" "stop.mjs" "src/app.js" "src/db-sqlite.js" \
                "public/index.html" "Shop Inventory.vbs" "node_modules/express"; do
  if [ ! -e "$STAGE/$required" ]; then echo "    MISSING: $required"; fail=1; fi
done
for forbidden in ".env" "data/shop.db" ".git"; do
  if [ -e "$STAGE/$forbidden" ]; then echo "    MUST NOT SHIP: $forbidden"; fail=1; fi
done
[ "$fail" = 0 ] || { echo "==> Build FAILED"; exit 1; }

echo "==> Zipping"
( cd "$BUILD" && rm -f ShopInventory-windows.zip \
  && zip -qr ShopInventory-windows.zip ShopInventory )

echo
echo "Built:  $BUILD/ShopInventory-windows.zip"
du -sh "$BUILD/ShopInventory-windows.zip" | awk '{print "Size:   "$1}'
echo
echo "Unzip on the Windows PC and double-click \"Shop Inventory.vbs\"."
echo "For a real Setup.exe, compile packaging/win/installer.iss with Inno Setup on Windows."
