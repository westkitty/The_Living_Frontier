#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_DIR="${SCRIPT_DIR:h:h}"
APP_DIR="$HOME/Applications/The Living Frontier.app"
CONTENTS_DIR="$APP_DIR/Contents"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
TEMP_ROOT="$(mktemp -d -t living-frontier-icon)"
ICONSET_DIR="$TEMP_ROOT/TheLivingFrontier.iconset"
/bin/mkdir -p "$ICONSET_DIR"

cleanup() { /bin/rm -rf "$TEMP_ROOT"; }
trap cleanup EXIT

/bin/mkdir -p "$CONTENTS_DIR/MacOS" "$RESOURCES_DIR"
/bin/cp "$SCRIPT_DIR/Info.plist" "$CONTENTS_DIR/Info.plist"
/usr/bin/sed "s|__REPO_DIR__|$REPO_DIR|g" "$SCRIPT_DIR/Launcher.in" >"$CONTENTS_DIR/MacOS/Launcher"
/bin/chmod 755 "$CONTENTS_DIR/MacOS/Launcher"

for size in 16 32 128 256 512 1024; do
  /opt/homebrew/bin/magick "$SCRIPT_DIR/TheLivingFrontier.svg" -background none -resize "${size}x${size}" "$ICONSET_DIR/icon_${size}x${size}.png"
  if [[ "$size" -le 512 ]]; then
    /opt/homebrew/bin/magick "$SCRIPT_DIR/TheLivingFrontier.svg" -background none -resize "$((size * 2))x$((size * 2))" "$ICONSET_DIR/icon_${size}x${size}@2x.png"
  fi
done
/usr/bin/iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/TheLivingFrontier.icns"
/usr/bin/touch "$APP_DIR"

/opt/homebrew/bin/dockutil --remove "$APP_DIR" --no-restart >/dev/null 2>&1 || true
/opt/homebrew/bin/dockutil --add "$APP_DIR" --section apps --no-restart >/dev/null
/usr/bin/killall Dock >/dev/null 2>&1 || true

echo "Installed and Dock-registered: $APP_DIR"
echo "Launcher target: $REPO_DIR"
