#!/bin/sh
# Builds Porchlight.app, a Mac window around `porchlight ui`.
#
#   sh mac/build.sh             build into mac/build/Porchlight.app, for this machine
#   sh mac/build.sh --install   also copy it to ~/Applications
#   sh mac/build.sh --dmg       build a self-contained app for any Apple silicon Mac and pack it
#                               into mac/build/Porchlight-<version>-arm64.dmg
#
# This machine's app runs this checkout's CLI with the node, gitleaks and osv-scanner found on PATH
# now. Rebuild it if you move the checkout or change Node.
#
# The DMG's app carries its own copy of the CLI, taken from the last commit (never from uncommitted
# changes), and of the node, gitleaks and osv-scanner on PATH now, with their licences. It holds no
# path, name or setting of this machine; everything is found from where the app is at each start.
#
# Either reads its settings at each start from ~/.porchlight/app.env (see app.env.example).
set -eu

mode=${1:-}
case "$mode" in
	"" | --install | --dmg) ;;
	*) echo "usage: sh mac/build.sh [--install | --dmg]" >&2; exit 64 ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/.." && pwd)
build="$here/build"
app="$build/Porchlight.app"
resources="$app/Contents/Resources"
cache="${TMPDIR:-/tmp}/porchlight-swift-cache"

node=$(command -v node) || { echo "node is not on PATH" >&2; exit 1; }
for tool in gitleaks osv-scanner; do
	command -v "$tool" >/dev/null || {
		[ "$mode" = --dmg ] && { echo "$tool is not on PATH, and the DMG's app carries its own copy" >&2; exit 1; }
		echo "warning: $tool is not on PATH; scans will list it under Not covered" >&2
	}
done

if [ "$mode" = --dmg ]; then
	[ "$(uname -m)" = arm64 ] || { echo "The DMG is built for Apple silicon, on an Apple silicon Mac" >&2; exit 1; }
	version=$(git -C "$repo" show HEAD:cli/package.json | sed -n 's/^[[:space:]]*"version": "\(.*\)",$/\1/p' | head -n 1)
	if [ -n "$(git -C "$repo" status --porcelain -- cli)" ]; then
		echo "note: cli/ has uncommitted changes; the DMG holds the last commit, $(git -C "$repo" rev-parse --short HEAD), without them" >&2
	fi
else
	version=$(sed -n 's/^[[:space:]]*"version": "\(.*\)",$/\1/p' "$repo/cli/package.json" | head -n 1)
fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$resources" "$cache"

echo "Compiling…"
# The source's path would otherwise be written into the binary.
swiftc -O -module-cache-path "$cache" -file-prefix-map "$here=mac" -o "$app/Contents/MacOS/Porchlight" "$here/Porchlight.swift"
swiftc -O -module-cache-path "$cache" -o "$build/icon" "$here/icon.swift"
rm -rf "$build/Porchlight.iconset"
"$build/icon" "$here/icon.png" "$build/Porchlight.iconset" "$here/../cli/ui/favicon.svg"
iconutil -c icns -o "$resources/Porchlight.icns" "$build/Porchlight.iconset"

# Reads ~/.porchlight/app.env: plain KEY=value lines only, nothing in the file is run. Settings
# written before the rename (in ~/.securityx, with the prefix SECURITYX_) are read too.
read_settings='settings="$HOME/.porchlight/app.env"
[ -f "$settings" ] || settings="$HOME/.securityx/app.env"
if [ -f "$settings" ]; then
	while IFS= read -r line || [ -n "$line" ]; do
		case "$line" in
			PORCHLIGHT_ROOT=*) root=${line#PORCHLIGHT_ROOT=} ;;
			SECURITYX_ROOT=*) root=${line#SECURITYX_ROOT=} ;;
			# The app opens its page with a key of its own; a fixed one would keep the window on
			# "Starting Porchlight…" for ever, as no link is printed for it to open (B60).
			PORCHLIGHT_UI_KEY=* | SECURITYX_UI_KEY=*) echo "app.env: PORCHLIGHT_UI_KEY is not used by the Mac app, which makes its own key" >&2 ;;
			PORCHLIGHT_[A-Z_]*=*) export "$line" ;;
			SECURITYX_[A-Z_]*=*) export "PORCHLIGHT_${line#SECURITYX_}" ;;
		esac
	done < "$settings"
fi
# A folder written as ~/code means code in the home folder, as in a shell (B60).
case "$root" in
	"~") root=$HOME ;;
	"~/"*) root=$HOME/${root#"~/"} ;;
esac
# Set last, so no line in app.env turns it off: the server stops when the app that started it goes away.
export PORCHLIGHT_STOP_WITH_STDIN=1'

if [ "$mode" = --dmg ]; then
	# The CLI as committed, with only what it runs: no tests, no development files.
	mkdir -p "$resources/porchlight" "$resources/bin" "$resources/licenses"
	git -C "$repo" archive --format=tar HEAD cli/bin cli/src cli/ui cli/package.json | tar -x -C "$resources/porchlight"

	# Node and the scanners: their release builds, which link only to the system's own libraries.
	licence() { # program, its licence file
		[ -f "$2" ] || { echo "No licence found for $1 at $2; the DMG must carry it" >&2; exit 1; }
		cp "$2" "$resources/licenses/$1.txt"
	}
	real_node=$(realpath "$node")
	cp "$real_node" "$resources/bin/node"
	licence node "$(dirname "$real_node")/../LICENSE"
	for tool in gitleaks osv-scanner; do
		real=$(realpath "$(command -v "$tool")")
		cp "$real" "$resources/bin/$tool"
		licence "$tool" "$(dirname "$real")/../LICENSE"
	done
	# Homebrew installs its programs read-only; the copies are the app's own.
	chmod 755 "$resources"/bin/*
	for program in "$resources"/bin/*; do
		file "$program" | grep -q 'arm64' || { echo "$program is not built for Apple silicon" >&2; exit 1; }
		if otool -L "$program" | tail -n +2 | grep -vqE '^[[:space:]]+/(usr/lib|System/Library)/'; then
			echo "$program needs libraries outside macOS, so it would not run on another Mac" >&2
			exit 1
		fi
	done
	"$resources/bin/node" -e 'const [a, b] = process.versions.node.split(".").map(Number); if (a < 22 || (a === 22 && b < 18)) { console.error(`Node ${process.versions.node} is too old: Porchlight needs 22.18 or later`); process.exit(1); }'

	cat > "$resources/launch.sh" <<'EOF'
#!/bin/sh
# Written by mac/build.sh --dmg. Starts `porchlight ui` from the copy inside Porchlight.app.
here=$(cd "$(dirname "$0")" && pwd)
# Scanners installed with Homebrew come first, so updating them there is enough. The app's own
# copies are the fallback. git comes from macOS's command line tools.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$here/bin"
root="$HOME/Projects"
[ -d "$root" ] || root="$HOME"
EOF
	printf '%s\n' "$read_settings" >> "$resources/launch.sh"
	cat >> "$resources/launch.sh" <<'EOF'
export NODE_NO_WARNINGS=1
exec "$here/bin/node" "$here/porchlight/cli/bin/porchlight.js" ui --root "$root"
EOF
else
	# The launcher for this machine. Values are fixed now, quoted for sh.
	quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
	cat > "$resources/launch.sh" <<EOF
#!/bin/sh
# Written by mac/build.sh. Starts \`porchlight ui\` for Porchlight.app.
export PATH=$(quote "$PATH")
repo=$(quote "$repo")
node=$(quote "$node")
root="\$HOME/Projects"
EOF
	printf '%s\n' "$read_settings" >> "$resources/launch.sh"
	cat >> "$resources/launch.sh" <<'EOF'
# The deployed monitor's token, if the monitor is set and no token was given.
if [ -n "${PORCHLIGHT_MONITOR_URL:-}" ] && [ -z "${PORCHLIGHT_ADMIN_TOKEN:-}" ] && [ -f "$repo/monitor/.secrets.production" ]; then
	PORCHLIGHT_ADMIN_TOKEN=$(sed -n 's/^ADMIN_TOKEN=//p' "$repo/monitor/.secrets.production")
	export PORCHLIGHT_ADMIN_TOKEN
fi
export NODE_NO_WARNINGS=1
exec "$node" "$repo/cli/bin/porchlight.js" ui --root "$root"
EOF
fi

cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleName</key><string>Porchlight</string>
	<key>CFBundleDisplayName</key><string>Porchlight</string>
	<key>CFBundleIdentifier</key><string>local.porchlight.app</string>
	<key>CFBundleExecutable</key><string>Porchlight</string>
	<key>CFBundleIconFile</key><string>Porchlight</string>
	<key>CFBundlePackageType</key><string>APPL</string>
	<key>CFBundleShortVersionString</key><string>$version</string>
	<key>CFBundleVersion</key><string>$version</string>
	<key>LSMinimumSystemVersion</key><string>13.5</string>
	<key>NSHighResolutionCapable</key><true/>
	<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF

# Extended attributes (where a file came from) are dropped before signing, so none ship.
xattr -cr "$app"
codesign --force --sign - "$app" >/dev/null
echo "Built $app"

if [ ! -f "$HOME/.porchlight/app.env" ]; then
	echo "No settings yet: copy mac/app.env.example to ~/.porchlight/app.env to connect the monitor or a model."
fi

if [ "$mode" = --install ]; then
	mkdir -p "$HOME/Applications"
	# The same app under its earlier name, built by this script: Porchlight.app replaces it.
	old="$HOME/Applications/SecurityX.app"
	if [ -d "$old" ] && [ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$old/Contents/Info.plist" 2>/dev/null)" = local.securityx.app ]; then
		rm -rf "$old"
		echo "Removed the app's copy under its earlier name"
	fi
	rm -rf "$HOME/Applications/Porchlight.app"
	cp -R "$app" "$HOME/Applications/Porchlight.app"
	echo "Installed ~/Applications/Porchlight.app"
fi

if [ "$mode" = --dmg ]; then
	dmg="$build/Porchlight-$version-arm64.dmg"
	stage="$build/dmg"
	rm -rf "$stage" "$dmg"
	mkdir -p "$stage"
	ditto --noextattr --noqtn "$app" "$stage/Porchlight.app"
	ln -s /Applications "$stage/Applications"
	cp "$here/dmg-readme.txt" "$stage/Read me first.txt"
	# Nothing of this machine goes in: its home folder, user and host names, and a program's library
	# search folders (scripts/check-dmg.sh). Names of the owner's own to look for too can be given in
	# PORCHLIGHT_DMG_FORBID, one per line. RELEASING.md runs it again on the finished DMG.
	sh "$repo/scripts/check-dmg.sh" "$stage" || { rm -rf "$stage"; exit 1; }
	hdiutil create -quiet -volname "Porchlight $version" -srcfolder "$stage" -fs HFS+ -format ULFO -ov "$dmg"
	rm -rf "$stage"
	echo "Built $dmg"
	shasum -a 256 "$dmg"
fi
