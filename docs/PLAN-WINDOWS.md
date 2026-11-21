# Porchlight on Windows: plan and milestones (2026-11-21)

**Status, 2026-11-21: not built.** A plan; nothing in it is true of Porchlight yet. It replaces the proposal of 2026-11-19, which predates 0.11.0 and 0.12.0.

**Goal.** Porchlight runs on a Windows 10 or 11 PC (x64 first, Arm64 after) the way it runs on a Mac: a download that opens in its own window, the same pages, the same scans, the same guarantees, and **This PC** in place of This Mac. The command line and the web interface work from a terminal before the app exists.

**What does not change.** Every invariant in `CLAUDE.md` holds on Windows. Where an invariant is written in Unix terms (`0600`, `/dev/null`, `SIGTERM`, `O_NOFOLLOW`, a shell), the milestone that meets it on Windows also rewrites its wording to say what is required, not how one system does it, and adds the Windows test.

## What a code study found (0.12.0)

Most of Porchlight is Node and plain JavaScript, so it runs on Windows. These are the parts that do not, by file, found by reading the code for every Unix assumption:

| Area | Where | What breaks on Windows | Milestone |
| --- | --- | --- | --- |
| **Paths in findings** | `cli/src/repos/gitleaks.ts` (`fileOf`, tracked-file maps), `osv.ts` (stderr paths), `includes.ts` | gitleaks reports `src\app.env`, git reports `src/app.env`: a committed key would not match its tracked file and would be called "on this computer only", or a finding would be missed. **A correctness bug, not a cosmetic one.** | W2 |
| **Repository names** | `cli/src/repos/report.ts` `nameUnder` (`path.relative`) | Names become `group\app`: filters, notes (`findingKey`), history, exports and links differ from the same repository on a Mac | W2 |
| **Child processes' environment** | `cli/src/repos/exec.ts` `childEnv` | It keeps a Unix allow-list (`HOME`, `XDG_*`). Windows programs need `SystemRoot`, `WINDIR`, `PATHEXT`, `TEMP`/`TMP`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `ProgramData`; without `SystemRoot` a Go program (gitleaks, osv-scanner) cannot even resolve names | W2 |
| **git's own settings switched off** | `cli/src/repos/git-copy.ts`, `cli/src/github/github.ts` | `GIT_CONFIG_GLOBAL=/dev/null` and `core.hooksPath=/dev/null`: Windows has `NUL`. Without this, the hostile-repository protection (invariant 14) silently does not hold | W2 |
| **Programs run through `.cmd`** | `cli/src/host/packages.ts` (`npm`), any `execFile` of a shim | Node refuses to run `.cmd` and `.bat` files without a shell. `npm` must be run as `node <npm-cli.js>`, Python through `py` | W2, W4 |
| **Files readable only by you** | `cli/src/private-files.ts`, `projects.ts`, `kept-files.ts`, `history.ts`, `settings-transfer.ts`, `doctor.ts` (14 files use `chmod`, `0o600`, `0o700` or mode checks) | `chmod` sets only the read-only flag. Privacy comes from the folder's access list (ACL); it must be checked, not assumed | W2 |
| **Data folder** | `~/.porchlight` throughout (`doctor.ts`, `help.ts`, `main.ts`) | `%LOCALAPPDATA%\Porchlight`, whose access list admits the account, SYSTEM and Administrators only | W2 |
| **Stopping cleanly** | `cli/src/repos/temp.ts` (cleanup on `SIGINT`/`SIGTERM`), `main.ts` `stopWithStdin` (`process.kill(self, "SIGTERM")`) | Windows delivers no `SIGTERM`; `process.kill` ends a process at once, so temporary copies of history are never removed | W2 |
| **Links and reparse points** | `projects.ts`, `gitleaks.ts` (`O_NOFOLLOW`), `discover.ts`, `includes.ts`, `evidence.ts`, `host/extras.ts` | `O_NOFOLLOW` does not exist (the flag becomes 0 and silently stops protecting). Junctions and other reparse points act as links and must be treated as links | W2 |
| **Path comparisons** | every "inside the repository / the data folder" check (`relative`, `startsWith`) | Paths are case-insensitive and may use either separator or a `\\?\` prefix: an inside check must compare normalised paths | W2 |
| **Long paths** | scans of deep `node_modules`, the history copy | 260-character paths fail unless `core.longpaths` is set for git and Porchlight uses long-path-safe calls | W3 |
| **This Mac** | `cli/src/host/` (macOS tools: `softwareupdate`, `fdesetup`, `socketfilterfw`, `lsof`, `plutil`) | A Windows host check is needed: **This PC** | W4 |
| **Schedules** | `cli/src/schedule.ts` (launchd and systemd only) | Task Scheduler | W5 |
| **The commit hook** | `cli/src/repos/hook.ts` (`hook print`) | Git for Windows runs hooks with its own `sh`, so the hook works; its install words and `porchlight` on PATH need checking | W5 |
| **The monitor setup script** | `scripts/setup-monitor.sh` | A shell script: a PowerShell twin, or "run it in Git Bash" | W5 |
| **The app** | `mac/Porchlight.swift`, `mac/build.sh` | A Windows app and its build: tray icon, notifications, Open at Login, the project-folder bridge (invariant 23), the server's last lines on failure | W6 |
| **The download** | `.github/workflows/ci.yml` (DMG job), `scripts/check-dmg.sh` | An installer built, searched and attested in CI | W7 |
| **The tests** | 58 test files: 21 assert Unix file modes, 19 use `/tmp`-style paths, 9 use `chmod`, 6 make symbolic links | They must run on `windows-latest`, or the work above has no proof | W1 |

## Milestones

Each ships as its own release, with tests that fail on Windows before it and pass after. Estimates are for one person and assume a Windows PC to try each step on.

### W0: Decisions and a Windows PC. Size: S

- **Decide** (each is the owner's):
  1. **The PowerShell rule** for This PC (invariant 19 forbids a shell today). Proposal: fixed scripts kept in the code (`cli/src/host/windows/*.ps1`), run as `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script>`, taking no input of any kind, printing JSON that is parsed strictly. The alternative is reading the registry and running only `.exe` tools (`netstat`, `reg`, `icacls`, `wmic` is gone), which covers less.
  2. **The installer**: MSIX (clean install and removal, no administrator), Inno Setup `.exe` (most familiar), or a portable `.zip`.
  3. **Signing**: Azure Trusted Signing (about $10 a month, an identity check), an OV certificate (about $200–400 a year), or unsigned with instructions, as the Mac app is unnotarized today.
  4. **The name**: "This PC" on Windows. This goes with owner decision 1 ("This Mac" or "This computer").
  5. **Arm64**: in the first release, or after.
- **A Windows PC to try each step on.** Yours is fine: remote access over Tailscale or SSH lets me run the steps myself; otherwise one command at a time, and you say what it printed.
- **Done when:** the decisions are recorded in this plan and a test run on the PC works.

### W1: The tests run on Windows in CI. Size: M

- A `windows` job on `windows-latest` running `npm run check` and `npm test`, with gitleaks and osv-scanner's Windows builds at the pinned versions, checked against their checksums, as the Linux job does (`PORCHLIGHT_REQUIRE_SCANNERS=1`).
- The tests made portable: paths built with `join` and `tmpdir()`, never `/tmp` or `/Users`; mode assertions replaced by a `private()` helper that checks the mode on Unix and the access list on Windows; link tests skipped only where Windows forbids links without Developer Mode, with the reason named, never silently.
- Expected failures are marked as such with the milestone that fixes them, so the job is green from the start and each later milestone removes its marks.
- **Done when:** the Windows job runs every test, every skip names its reason, and no expected failure is left without a milestone.

### W2: The core is correct on Windows. Size: L

- **Paths:** one `repoPath()` helper turns every path Porchlight reports or compares into the repository's own form (`/`), at the edge where a scanner's output is read (`gitleaks.ts`, `osv.ts`, `includes.ts`). Repository names (`nameUnder`) use `/` on every system, so notes, history, filters and exports match across systems. Inside checks compare normalised, case-folded paths.
- **Child processes:** `childEnv` keeps the Windows variables named above as well, still dropping every key and token; `safePath` keeps only absolute folders, as now. `NUL` in place of `/dev/null` for git's settings. `.cmd` shims run through their real program (`node npm-cli.js`, `py -3`).
- **Privacy:** the data folder is `%LOCALAPPDATA%\Porchlight`. At start, and in `doctor`, its access list is read with `icacls` (a fixed `.exe`, no shell) and anything that lets another account read it is a problem with the fix to run. Files are written inside it, so they inherit its list; a project folder (invariant 23) is checked the same way. Invariant wording moves from "0600" to "readable only by the account that runs Porchlight", with the test per system.
- **Stopping:** a `shutdown()` in the server that removes temporary copies and closes listeners, called by `SIGINT` (Ctrl+C works on Windows), by stdin closing (the app), and by Windows' console close event; `SIGTERM` stays for Unix. Temporary folders are swept at start, as now.
- **Links:** every "do not follow a link" check also refuses junctions and other reparse points (`lstat().isSymbolicLink()` covers symlinks; junctions are checked by comparing `realpath` with the path). `O_NOFOLLOW` is replaced on Windows by that check before opening.
- **Done when:** the hostile-repository tests and the path, privacy and link tests pass on Windows; a scan of the same repository on a Mac and on Windows gives the same names, keys and findings.

### W3: Scanning parity. Size: M

- The hostile-repository suite (`cli/test/hostile-history.test.ts`) passes on Windows with Git for Windows: `diff.external`, filters, `core.fsmonitor`, hooks, replace refs and grafts all stay off.
- Long paths: `core.longpaths=true` on every git call; the history copy and the files copy work past 260 characters.
- Line endings: a key in a CRLF file is found once, at the right line.
- The SBOM, private data, photos, workflows (FT-2) and `porchlight hook` work on Windows; `hook print` says how Git for Windows runs it.
- **Done when:** the scan tests that use the real scanners pass on Windows, including a repository with a 300-character path and CRLF files.

### W4: This PC. Size: L

The same five parts as This Mac, plus what 0.11.0 added, read with Windows' own tools under invariant 19 (only reads, never as administrator, "Could not check" when it cannot tell):

| Part | What it reads |
| --- | --- |
| Updates | Windows Update's pending updates (`Microsoft.Update.Session` search), and whether updates install by themselves |
| Built-in protection | Defender (real-time protection, signature age), the firewall per profile, BitLocker on the system drive, SmartScreen, UAC level, Secure Boot ("Could not check" without administrator) |
| Signing in | Automatic sign-in (`AutoAdminLogon`; a stored password is never read, only whether one is set), screen lock, the guest account |
| Reachable from the network | Listening ports and the program behind each, naming Remote Desktop (3389), SMB (445), WinRM (5985/5986) and OpenSSH (22) |
| Credentials in files | The same files as on the Mac, under `%USERPROFILE%` and `%APPDATA%`, with who else may read each (`icacls`); contents never read (invariant 3) |
| Programs that start by themselves (FT-8) | Run and RunOnce keys, the Startup folder, scheduled tasks, each flagged when its program is in a temporary or user-writable folder |
| Browser extensions (FT-8) | Edge and Chrome profiles under `%LOCALAPPDATA%`, Firefox under `%APPDATA%`: extensions with access to every site, by name and permission |
| SSH (FT-8) | `%USERPROFILE%\.ssh\config` and what it includes, as on the Mac |
| Installed packages | npm global and `py -3 -m pip list`, looked up on OSV.dev when asked; winget upgrades available, and Scoop or Chocolatey when present |

- Every reader's parser is tested on recorded output from a real PC, as the macOS ones are.
- **Commands to fix these:** one `winget upgrade` line and one line each for npm and Python; anything that needs a decision (turning off Remote Desktop) stays with its check.
- **Done when:** a real run on your PC matches what Windows' own settings show, every part says "Could not check" rather than pass when a reader fails, and nothing runs as administrator.

### W5: Schedules, the hook and setup on Windows. Size: S–M

- `porchlight schedule print --task` prints a Task Scheduler task (XML) for the owner to import; it installs nothing (as `schedule print` does now).
- `porchlight` on PATH from `npm install -g ./cli` (npm makes a `.cmd` shim), and the README's quick start for Windows.
- `scripts/setup-monitor.ps1`, a PowerShell twin of the monitor setup script, or the README says to run the `.sh` in Git Bash.
- **Done when:** a scheduled Standard scan runs from Task Scheduler and sends its notice, and the monitor can be set up from a Windows PC.

### W6: The Windows app. Size: L

A small program shows the page in a window, as the Mac app does: C# with **WebView2** (the Edge engine Windows 10 and 11 already have), a few hundred lines, no Electron.

- It starts the server from its own folder with its bundled `node.exe`, holds its stdin open so the server stops with it (B53), and shows the server's last lines, with the key masked, if the page does not open within 30 seconds.
- **Tray icon** in place of the menu bar (FT-15): the critical and high count, the age of the last scan, coverage; read from `/api/menu-status` with this run's key.
- **Notifications** when a scan finishes, from counts only, off until switched on.
- **Open at Login**, off by default, the owner's switch (a Run key or a scheduled task at sign-in).
- **The project-folder bridge** (invariant 23): answers only its own page's main frame, hands back a folder the owner picked, and shows in Explorer only an existing path inside a folder named `Porchlight`.
- Outside links open in the default browser, only for `https:` and Windows' own settings (`ms-settings:`); asks before quitting while a scan runs; exports go to Downloads.
- It carries `node.exe`, `gitleaks.exe` and `osv-scanner.exe` (x64, and Arm64 if decided) with their licences, and prefers newer scanners installed with winget or Scoop.
- **Done when:** the app installs, scans, shows This PC, survives a crash of the page, and leaves no server running after it quits.

### W7: Installer, signing and release. Size: M

- `windows/build.ps1` builds the app and the installer chosen in W0.
- A CI job on `windows-latest` on a `v*` tag: build from the tag only, search the installer for the build machine's paths and names (a twin of `scripts/check-dmg.sh`), attest it, and add it with its checksum to the drafted release beside the DMG.
- Signing as decided; unsigned until then, with the SmartScreen steps in the release notes, as the Mac app's Gatekeeper steps are.
- README: the Windows row of the install table, "Verify a download" for the installer, and the platform list (the owner's rule: command line, web interface and container on Linux, macOS and Windows; the desktop app on macOS and Windows).
- **Done when:** a tag produces a verified, attested Windows download, and the first Windows release is published.

### W8: A real-PC beta and the documents. Size: S–M

- A week of daily use on your PC: scans of your repositories, This PC, the monitor and Cloudflare pages, a schedule, a project folder.
- `CLAUDE.md`: each invariant written in Unix terms restated for both systems with its Windows test (privacy, links, stopping, the PowerShell rule if chosen, the Windows app's bridge in invariant 23).
- The audit plan gains a Windows sweep in its next round.
- **Done when:** a week passes with no Windows-only fault left open.

## Order and size

W0 → W1 → W2 → W3 can start as soon as the PC is reachable; W4 and W5 can run beside W3; W6 needs W2; W7 needs W6. In all, about 6 to 9 weeks of work, most of it W2, W4 and W6. The command line and the page are usable on Windows after W3; the app after W7.

## What I need from you, in one place

1. A way to run commands on a Windows PC: Tailscale or SSH access is best.
2. The five W0 decisions: the PowerShell rule, the installer, signing, "This PC", Arm64.
3. For signing, when chosen: the account or certificate, set up by you, since it involves an identity check and payment.
