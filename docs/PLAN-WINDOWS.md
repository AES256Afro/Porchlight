# Porchlight on Windows: plan (2026-11-19)

Goal: Porchlight runs on a Windows 10 or 11 PC the way it runs on a Mac. You download it, open it, and get the same pages, including **This PC** (the Windows version of This Mac). Nothing here is built yet. The owner decides what is marked **Decide**.

## What already works, and what does not

The CLI and the web interface are Node and plain JavaScript, so most of Porchlight runs on Windows as it is. These parts need work:

| Part | On Windows today | Work |
| --- | --- | --- |
| Scans (gitleaks, osv-scanner, git) | Both scanners publish Windows builds; git comes with Git for Windows | Path handling (`C:\`, backslashes) in the scanner and the report; test on a real PC |
| Files readable only by you (`0600`) | `chmod` has no effect on Windows | Keep data in `%LOCALAPPDATA%\Porchlight`, which only the account can read by default, and check that with `icacls` at start; tests for it |
| Data folder | `~/.porchlight` | `%LOCALAPPDATA%\Porchlight` on Windows |
| Stopping the server | It relies on signals | Close cleanly when the window closes (Windows has no SIGTERM) |
| Access from other devices | Finds the Tailscale address from the network interfaces | Works the same; test it |
| This Mac | macOS tools only | A Windows check: see below |
| App and download | The Mac app is Swift and a DMG | A Windows app and an installer: see below |

## The app

A small Windows program shows the page in a window, as the Mac app does. It starts `porchlight ui` from its own folder and stops it when you quit. It also asks before quitting while a scan is running, saves exports to Downloads, and opens outside links in the browser.

- **Window**: C# with **WebView2**, the Edge engine that Windows 10 and 11 already have. That avoids Electron (about 150 MB) and keeps the download near the Mac app's size. The program is a few hundred lines, like `mac/Porchlight.swift`.
- **What it carries**: `node.exe`, `gitleaks.exe` and `osv-scanner.exe` for x64 and Arm64, with their licences, as the DMG does. It uses scanners from winget or Scoop if newer ones are installed.
- **Download**: a signed installer, **Decide**:
  - **MSIX**: clean install and uninstall, and no admin rights needed.
  - **Inno Setup .exe**: the most familiar kind of installer.
  - **A portable .zip**: nothing installed at all.
- **Signing**, **Decide**: unsigned downloads trigger SmartScreen ("Windows protected your PC"), much as macOS's "not notarized" warning does. Options:
  - Azure Trusted Signing: about $10 a month, and needs an identity check.
  - An OV code-signing certificate: about $200–400 a year.
  - Ship unsigned, with instructions, as the Mac app does today.
- **Build**: a `windows/build.ps1` script, and a CI job on `windows-latest` that runs the tests and builds the installer from a tag, as the DMG step does for the Mac.

## This PC: the Windows host check

These are the same five parts as This Mac, read with Windows' own tools. The same rules apply (CLAUDE.md invariant 19): it only reads, never runs as administrator, and anything it cannot read is "Could not check", never a pass.

| Part | What it reads | Without admin? |
| --- | --- | --- |
| Updates | Windows Update's pending updates (the `Microsoft.Update.Session` COM search), and whether updates install automatically | Yes |
| Built-in protection | Defender: real-time protection on, signatures' age (`Get-MpComputerStatus`); firewall on for each profile (`Get-NetFirewallProfile`); BitLocker on the system drive (read through Explorer's drive property; `manage-bde` needs admin); SmartScreen; UAC level; Secure Boot | Mostly; Secure Boot needs admin, so it shows as "Could not check" for a standard account |
| Login | Automatic sign-in (Winlogon `AutoAdminLogon`; the stored password is **never read**, only whether one is set); screen lock after the screen saver; the guest account | Yes |
| Reachable from the network | Listening ports with the program behind each (`Get-NetTCPConnection -State Listen` and process paths). Named: Remote Desktop (3389), SMB file sharing (445), WinRM (5985/5986), OpenSSH (22) | Yes; some system processes show no path without admin |
| Credentials in files | The same files as on the Mac, under `%USERPROFILE%` and `%APPDATA%` (GitHub CLI). Instead of Unix permissions, it checks who else may read them (`icacls`) | Yes |
| Installed packages | npm global and `py -3 -m pip list`, looked up on OSV.dev; **winget** upgrades available (as Homebrew on the Mac), and Scoop or Chocolatey if present | Yes |

**One rule changes, Decide.** Most of these answers come from PowerShell, and PowerShell is a shell, which invariant 19 rules out today. The proposal:

- Each check is a fixed script kept in the code (`cli/src/host/windows/*.ps1`), run as `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script>`.
- A script takes no input, so nothing from a page, a file or a request is ever put into one.
- It prints JSON, which the check parses strictly.
- The tests run every parser on recorded output, as they do for macOS.

**Commands to fix these** works as on the Mac. winget upgrades go into one `winget upgrade` line and npm and Python into one line each. Steps that need a decision stay with their checks, such as turning off Remote Desktop.

## Order of work

1. **CLI and page on Windows**, about 1 week: paths, the data folder and file privacy, a CI job on `windows-latest`. Scans and the page then work from a terminal (`porchlight ui`).
2. **This PC**, about 1–2 weeks: the scripts, parsers and tests above, plus a real run on your Windows PC.
3. **The app and installer**, about 1 week: the WebView2 window, the bundled tools, the installer, CI building it from a tag.
4. **Signing**: when you choose an option. Until then, the download says how to get past SmartScreen.

## What I need from you

- A Windows PC to try each step on. Yours is fine: I give you one command to run, and you tell me what it printed. Remote access over Tailscale or SSH would let me run it myself.
- Your choices on the installer type, on signing, and on the PowerShell rule.
- Whether Arm64 Windows matters to you; x64 comes first.
