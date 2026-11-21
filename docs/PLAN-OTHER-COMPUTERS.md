# Checking other computers: plan (2026-11-19)

**Status, 2026-11-21: not built.** A proposal; nothing in it is true of Porchlight yet.

Goal: from Porchlight, pick which computer to check. That can be the computer Porchlight runs on, the BoxPilot server, or another device on your network, such as your MacBook or your Windows PC. Today **This Mac** checks only the machine Porchlight runs on, and under BoxPilot it does not run at all, because a container cannot see its host. Nothing here is built yet. The owner decides what is marked **Decide**.

## What it would look like

A **Computers** page, under "Your computer", replaces the single This Mac page:

```
Computers                                         [Find devices]
  ● bigbox            BoxPilot server · Ubuntu 26.04   checked 2 h ago   4 problems
  ● chriss-macbook    macOS 27.2 · Porchlight app      checked 10 min    18 problems
  ○ windows-desktop   Windows 11 · not set up          [Set up]
  ○ iphone            iOS · cannot be checked
```

Opening a computer shows the same report as This Mac today (updates, protection, network, credentials, packages, and Commands to fix these), checked on that machine.

## Part 1: finding the devices

| Option | How it works | Fits Porchlight's rules? | Notes |
| --- | --- | --- | --- |
| **A. Your tailnet** (recommended) | Read the device list Tailscale already has: `tailscale status --json` on the BoxPilot server, or the Tailscale API with a read-only key. It gives each device's name, operating system, address and whether it is online. | Yes: nothing is scanned; it reads a list you already keep | Covers every device you have added to Tailscale, including when you are away from home. BoxPilot already relies on Tailscale |
| **B. Your router's client list** | You run the UniFi Network Application on bigbox. Its API lists every device on the LAN with names and makers | Yes: it reads your own router | Covers devices that aren't on Tailscale (printers, TVs). Needs a UniFi login, kept like the other keys |
| **C. Listening on the LAN** | mDNS/Bonjour (Macs and printers announce themselves) and the server's neighbour table (`ip neigh`) | Yes: passive, nothing is sent to the devices | The container needs the host's network; incomplete, since Windows PCs often stay quiet |
| **D. Scanning the network** | A ping sweep or port scan of your subnet, like nmap | **No**: rule 2 ("passive only") forbids port scanning. It would need an owner-started, approved action limited to your own subnets, like investigations | Can upset routers and security software. Only worth it for devices nothing else finds |

**Recommendation:** A first, B as an option. Leave D out, unless you want it as an explicit, approved "scan my LAN" step later.

## Part 2: checking a device

Finding a device only says it exists. To check it, something has to read it from the inside: its updates, its firewall, its files.

| Option | How it works | Pros | Cons |
| --- | --- | --- | --- |
| **1. Porchlight on each device reports in** (recommended) | Each device runs Porchlight: the Mac app, the Windows app, or `porchlight host check --send` on a schedule (launchd on a Mac, Task Scheduler on Windows, systemd on Linux). It checks itself and sends the result to your Porchlight on BoxPilot, over Tailscale, with that device's own key. You pair a device once with a code shown on the Computers page, like "Access from other devices" today | Same accurate local checks as This Mac. No remote access to the device, and no passwords kept on the server. Works with the machine asleep or away: you see its last report | Porchlight must be installed on each device |
| **2. Check over SSH** | Porchlight on BoxPilot logs in to a device with an SSH key and runs the read-only commands | Nothing to install, apart from turning on SSH | Remote Login must be on, which the Mac check itself flags as a risk. The server holds a key that can log in to all your machines, so a break-in on the server reaches them all. Windows needs OpenSSH set up |
| **3. A remote-management agent** (osquery, Wazuh, MDM) | Run an existing fleet tool and read its results | Mature and broad | A large system to run and secure for a handful of devices; more than this needs |

**Recommendation: option 1.** It keeps everything Porchlight promises:
- a check only reads, and runs on the device it checks;
- results stay inside your tailnet;
- the server never holds a key that can log in to your other computers.

## Part 3: the BoxPilot server itself

Inside its container, Porchlight cannot see bigbox. There are three ways to fix that, **Decide**:

- **a. A host-side Porchlight run by BoxPilot** (recommended). BoxPilot installs a small systemd timer on the server that runs `porchlight host check` on the host as an unprivileged user. It writes the result where the app can read it. The app stays in its container, with no extra privileges. BoxPilot already manages host services, so this fits how it works.
- **b. BoxPilot answers for its host.** BoxPilot already reads much of this (updates, firewall, services), so it could share those facts with Porchlight through its app API. This is less code in Porchlight, but the check would then be BoxPilot's.
- **c. Give the container a view of the host** (host network, `/proc`, read-only mounts of `/etc`). This is simple, but it weakens the container's isolation for every other part of Porchlight. Not recommended.

The Linux check reads:
- pending security updates (apt) and whether unattended-upgrades is on;
- the firewall (ufw or nftables);
- SSH settings (password login, root login);
- listening ports with their programs (`ss -ltnp`);
- disk encryption (LUKS);
- the same credential files and installed packages as on the Mac.

## Rules that change

- **Rule 19** (the host check only reads) extends to reports sent from other devices. A device only ever sends its own check. The server stores each report 0600, under that device's name, and never sends anything back to run.
- **Rule 7** (the page answers only its own page) gains a third kind of caller: a paired device. It may only post its report, with its own key, and only over the tailnet.
- **Rule 2** (passive only) is unchanged, unless you choose option D.

## Order of work

1. **Linux host check, and the BoxPilot server through option a**, about 1–2 weeks. bigbox shows up in the page.
2. **Device reports (option 1)**, about 2 weeks: `--send`, pairing codes, the Computers page, and Mac and Windows schedules. The Mac app can report as soon as it is paired.
3. **Finding devices through Tailscale (option A)**, about 1 week, so unpaired devices show up with **Set up**.
4. Windows reporting arrives with the Windows app (see PLAN-WINDOWS.md).
5. Optional: the router's client list (B), and an approved LAN scan (D) if you want it.

## What I need from you

- Choices on option A or B for finding devices, a for the BoxPilot server, and whether D is ever wanted.
- For A through the Tailscale API: a read-only API key, or permission for BoxPilot to read `tailscale status` on bigbox.
- One device of each kind to try it on: bigbox, this Mac and your Windows PC.
