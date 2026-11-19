#!/bin/sh
# Builds SecurityX.app, a Mac window around `securityx ui`, for this machine only.
#
#   sh mac/build.sh             build into mac/build/SecurityX.app
#   sh mac/build.sh --install   also copy it to ~/Applications
#
# The app runs this checkout's CLI with the node, gitleaks and osv-scanner
# found on PATH now. Rebuild it if you move the checkout or change Node.
# Settings are read at each start from ~/.securityx/app.env (see app.env.example).
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/.." && pwd)
build="$here/build"
app="$build/SecurityX.app"
cache="${TMPDIR:-/tmp}/securityx-swift-cache"

node=$(command -v node) || { echo "node is not on PATH" >&2; exit 1; }
for tool in gitleaks osv-scanner; do
	command -v "$tool" >/dev/null || echo "warning: $tool is not on PATH; scans will list it under Not covered" >&2
done
version=$(sed -n 's/^[[:space:]]*"version": "\(.*\)",$/\1/p' "$repo/cli/package.json" | head -n 1)

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$cache"

echo "Compiling…"
swiftc -O -module-cache-path "$cache" -o "$app/Contents/MacOS/SecurityX" "$here/SecurityX.swift"
swiftc -O -module-cache-path "$cache" -o "$build/icon" "$here/icon.swift"
"$build/icon" "$repo/cli/ui/favicon.svg" "$build/SecurityX.iconset"
iconutil -c icns -o "$app/Contents/Resources/SecurityX.icns" "$build/SecurityX.iconset"

# The launcher. Values are fixed now, quoted for sh.
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
cat > "$app/Contents/Resources/launch.sh" <<EOF
#!/bin/sh
# Written by mac/build.sh. Starts \`securityx ui\` for SecurityX.app.
export PATH=$(quote "$PATH")
repo=$(quote "$repo")
node=$(quote "$node")
EOF
cat >> "$app/Contents/Resources/launch.sh" <<'EOF'
settings="$HOME/.securityx/app.env"
root="$HOME/Projects"
if [ -f "$settings" ]; then
	# Plain KEY=value lines only; nothing in the file is run.
	while IFS= read -r line || [ -n "$line" ]; do
		case "$line" in
			SECURITYX_ROOT=*) root=${line#SECURITYX_ROOT=} ;;
			SECURITYX_[A-Z_]*=*) export "$line" ;;
		esac
	done < "$settings"
fi
# The deployed monitor's token, if the monitor is set and no token was given.
if [ -n "${SECURITYX_MONITOR_URL:-}" ] && [ -z "${SECURITYX_ADMIN_TOKEN:-}" ] && [ -f "$repo/monitor/.secrets.production" ]; then
	SECURITYX_ADMIN_TOKEN=$(sed -n 's/^ADMIN_TOKEN=//p' "$repo/monitor/.secrets.production")
	export SECURITYX_ADMIN_TOKEN
fi
export NODE_NO_WARNINGS=1
exec "$node" "$repo/cli/bin/securityx.js" ui --root "$root"
EOF

cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>SecurityX</string>
	<key>CFBundleDisplayName</key><string>SecurityX</string>
	<key>CFBundleIdentifier</key><string>local.securityx.app</string>
	<key>CFBundleExecutable</key><string>SecurityX</string>
	<key>CFBundleIconFile</key><string>SecurityX</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>$version</string>
	<key>CFBundleVersion</key><string>$version</string>
	<key>LSMinimumSystemVersion</key><string>12.0</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF

codesign --force --sign - "$app" >/dev/null
echo "Built $app"

if [ ! -f "$HOME/.securityx/app.env" ]; then
	echo "No settings yet: copy mac/app.env.example to ~/.securityx/app.env to connect the monitor or a model."
fi

if [ "${1:-}" = "--install" ]; then
	mkdir -p "$HOME/Applications"
	rm -rf "$HOME/Applications/SecurityX.app"
	cp -R "$app" "$HOME/Applications/SecurityX.app"
	echo "Installed ~/Applications/SecurityX.app"
fi
