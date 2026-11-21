#!/bin/sh
# Searches a Porchlight DMG, or the folder it is made from, for anything of the machine that built it.
#
#   sh scripts/check-dmg.sh <file.dmg | folder> [name …]
#
# The DMG must hold no path, name, setting or token of that machine (CLAUDE.md, RELEASING.md). This
# replaces searching a mounted DMG by hand. It fails on any of:
#   - this machine's home folder, /Users/<user> and /home/<user>, anywhere in any file's contents or
#     in a file's name, in any case;
#   - its host names and this user's full name (when it is a name and not just the user name), as
#     whole words in any case; a host name shorter than 6 characters ("Mac") is too ordinary a word
#     and is left out, with a note;
#   - each name given after the DMG, and each line of PORCHLIGHT_DMG_FORBID, as whole words in any
#     case: the owner's other names, a tailnet name, a monitor address, a domain;
#   - a program that looks for libraries in a folder of this machine (an absolute LC_RPATH outside
#     /usr/lib and /System), which `otool -L` does not show.
# The bare user name is searched only as part of a path: alone it is often an ordinary word ("runner"
# on CI, a first name inside a time-zone name). Give it as a name to search for it everywhere.
# Nothing here is written to the DMG. Which names were searched for is printed, so a log shows it.
set -eu

target="${1:?usage: sh scripts/check-dmg.sh <file.dmg | folder> [name …]}"
shift

work="$(mktemp -d "${TMPDIR:-/tmp}/porchlight-check-dmg.XXXXXX")"
mounted=""
cleanup() {
	if [ -n "$mounted" ]; then hdiutil detach -quiet "$mounted" >/dev/null 2>&1 || hdiutil detach -quiet -force "$mounted" >/dev/null 2>&1 || true; fi
	rm -rf "$work"
}
trap cleanup EXIT INT TERM

if [ -d "$target" ]; then
	root="$target"
elif [ -f "$target" ]; then
	command -v hdiutil >/dev/null || { echo "check-dmg: hdiutil is needed to open $target (macOS only); give the folder instead" >&2; exit 1; }
	mkdir "$work/mount"
	# Read-only, not shown in Finder, and not opened by anything else.
	hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$work/mount" "$target" >/dev/null
	mounted="$work/mount"
	root="$mounted"
else
	echo "check-dmg: $target is neither a DMG nor a folder" >&2
	exit 1
fi

# What to search for. Substrings in any case: paths and host names, which are never ordinary words.
substrings="$work/substrings"
# Whole words in any case: names.
words="$work/words"
: >"$substrings"
: >"$words"
add() { # list, value[, shortest]: blank values and ones shorter than that (3) are left out
	value=$(printf '%s' "$2" | tr -d '\r')
	[ -n "$value" ] || return 0
	if [ "${#value}" -lt "${3:-3}" ]; then
		echo "check-dmg: not searching for \"$value\": too short to tell from an ordinary word" >&2
		return 0
	fi
	grep -qixF -- "$value" "$1" 2>/dev/null || printf '%s\n' "$value" >>"$1"
}

user="${USER:-$(id -un)}"
add "$substrings" "${HOME:-}"
add "$substrings" "/Users/$user"
add "$substrings" "/home/$user"
for host in "$(hostname 2>/dev/null || true)" "$(hostname -s 2>/dev/null || true)" \
	"$(scutil --get ComputerName 2>/dev/null || true)" "$(scutil --get LocalHostName 2>/dev/null || true)"; do
	add "$words" "$host" 6
done
full="$(id -F 2>/dev/null || getent passwd "$user" 2>/dev/null | cut -d: -f5 | cut -d, -f1 || true)"
case "$full" in
	*" "*) add "$words" "$full" ;;
esac
for name in "$@"; do add "$words" "$name"; done
if [ -n "${PORCHLIGHT_DMG_FORBID:-}" ]; then
	printf '%s\n' "$PORCHLIGHT_DMG_FORBID" | while IFS= read -r name; do add "$words" "$name"; done
fi

echo "check-dmg: searching $target"
echo "  for these anywhere:"
sed 's/^/    /' "$substrings"
if [ -s "$words" ]; then
	echo "  and these as whole words:"
	sed 's/^/    /' "$words"
fi

problems=0
report() {
	echo "check-dmg: $*" >&2
	problems=$((problems + 1))
}

# Contents. -a reads programs as text, so a path compiled into a binary is found too.
while IFS= read -r needle; do
	grep -r -a -i -F -l -- "$needle" "$root" 2>/dev/null >"$work/hits" || true
	while IFS= read -r hit; do report "\"$needle\" is in ${hit#"$root"/}"; done <"$work/hits"
	find "$root" -print 2>/dev/null | grep -i -F -- "$needle" >"$work/hits" || true
	while IFS= read -r hit; do report "\"$needle\" is in the name ${hit#"$root"/}"; done <"$work/hits"
done <"$substrings"
while IFS= read -r needle; do
	grep -r -a -i -w -F -l -- "$needle" "$root" 2>/dev/null >"$work/hits" || true
	while IFS= read -r hit; do report "\"$needle\" is in ${hit#"$root"/}"; done <"$work/hits"
	find "$root" -print 2>/dev/null | grep -i -w -F -- "$needle" >"$work/hits" || true
	while IFS= read -r hit; do report "\"$needle\" is in the name ${hit#"$root"/}"; done <"$work/hits"
done <"$words"

# Programs: an absolute run-path search folder outside macOS's own points at the building machine.
if command -v otool >/dev/null; then
	find "$root" -type f -perm -u+x -print 2>/dev/null >"$work/programs"
	while IFS= read -r program; do
		file "$program" | grep -q 'Mach-O' || continue
		otool -l "$program" | awk '/cmd LC_RPATH/ { getline; getline; print $2 }' >"$work/rpaths" || true
		while IFS= read -r rpath; do
			case "$rpath" in
				@*|/usr/lib/*|/System/*) ;;
				*) report "${program#"$root"/} looks for libraries in $rpath" ;;
			esac
		done <"$work/rpaths"
	done <"$work/programs"
else
	echo "check-dmg: otool is not here, so programs' library search folders were not checked" >&2
fi

if [ "$problems" -gt 0 ]; then
	echo "check-dmg: $problems problem(s); do not publish this DMG" >&2
	exit 1
fi
echo "check-dmg: nothing of this machine found"
