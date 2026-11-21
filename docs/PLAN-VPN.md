# Tailscale, WireGuard and VPNs: plan (2026-11-19)

**Status, 2026-11-21: not built.** A proposal; nothing in it is true of Porchlight yet.

Three questions from the owner, and a recommendation for each. Nothing here is built yet. The owner decides what is marked **Decide**.

1. Should Porchlight's outbound checks go through a VPN, with a toggle or always on?
2. Should it check that Tailscale or WireGuard is up?
3. Should it audit what Tailscale Serve and Funnel expose?

## Where things stand

- Porchlight already uses Tailscale for one thing: **Access from other devices** adds a listener on the Tailscale address of the computer that runs Porchlight only (100.64.0.0/10, invariant 7), and BoxPilot publishes the container on the tailnet (`defaultExposure: tailnet`, invariant 9).
- **This Mac** treats a service listening only on the tailnet address as passed, and flags Remote Login and the other Sharing services.
- Outbound traffic today, all over HTTPS to fixed addresses: OSV.dev, Apple's update servers, GitHub, the model you choose, Cloudflare's API and its DNS-over-HTTPS resolver, the monitor, and, in an investigation, the requests you approve to your own domain.

## 1. Sending checks through a VPN

| Option | How | For | Against |
| --- | --- | --- | --- |
| **A. Leave routing to the system, and say which way traffic leaves** (recommended) | Porchlight never changes routes. When the host check sees a Tailscale exit node or another VPN in use, the pages that reach out (Investigate, the Cloudflare audit's lookups, OSV.dev) say "Leaving through <exit node>" | Nothing to install or run as root; the owner's own VPN choice applies to Porchlight as to every other app; honest about where requests come from | No per-feature control |
| B. A toggle per feature that binds its sockets to the tunnel (`localAddress` on the `utun`/`tailscale0`/`wg0` address) | Node can bind outgoing HTTP and TCP to one interface address | Investigation requests could come from the BoxPilot server's exit, say, while everything else goes direct | Only means something with an exit node; fails as soon as the tunnel is down, and "fails closed" then has to be designed per feature; easy to believe traffic is tunnelled when it is not |
| C. Always on, Porchlight bringing the VPN up | Porchlight starts WireGuard or sets a Tailscale exit node | — | Needs administrator rights and a network extension, and changes a system setting, which invariant 19 rules out for the host check; one more thing that can lock you out of your own Mac |

The calls Porchlight makes are to public APIs that authenticate with your keys over TLS: a tunnel adds no protection to them. Where the source address matters is an investigation of your own site (an origin that admits only some addresses, or wanting to see what the public sees). That is better served by choosing *which computer* runs the investigation (the Mac, or the BoxPilot server, see `docs/PLAN-OTHER-COMPUTERS.md`) than by Porchlight steering routes.

**Recommendation: A.** Do not build B or C. **Decide:** whether B is worth it for investigations later, after the multi-computer work.

## 2. Checking that Tailscale or WireGuard is up

Yes, as a new part of **This Mac**, "VPN and tailnet", with the same rules as the rest of the host check (invariant 19): only read, each command with a time limit, no `sudo`, and anything not recognised is **Could not check**.

| Check | How (read-only) | Problem when | Severity |
| --- | --- | --- | --- |
| Tailscale running and logged in | `tailscale status --json`: `BackendState` | not `Running`, when Access from other devices is on, or when you said you rely on it | medium |
| Node key expiry | `Self.KeyExpiry` in the same output | within 14 days (the device drops off the tailnet when it passes) | medium; low within 30 |
| Exit node in use | `ExitNodeStatus` | never a problem: shown, so the pages can say where traffic leaves (part 1) | — |
| Tailscale SSH on this Mac | the node's preferences (`tailscale debug prefs`, `RunSSH`; to check on the installed version, since `debug` output is not a stable interface) | on, and you did not say you use it | medium, like Remote Login |
| Other VPN configurations | `scutil --nc list` lists every VPN set up in macOS (including the WireGuard app, which uses a network extension) and whether each is connected | one you marked "should always be on" is disconnected | medium |
| WireGuard interfaces | `ifconfig` (`utun` interfaces) | — (shown only: `wg show` needs root, so keys and peers are not read) | — |

On Windows (`docs/PLAN-WINDOWS.md`) the same `tailscale status --json` works; WireGuard's `wg.exe show` needs an administrator, so only whether its tunnel service is running (`Get-Service WireGuardTunnel*`). In the BoxPilot container none of this is visible; the server's Tailscale is covered by part 3 or by the agent in `docs/PLAN-OTHER-COMPUTERS.md`.

A VPN being down is a problem only if you rely on it. **Decide:** a setting "I expect these to be on" (Tailscale, and each VPN listed by `scutil`); until it is set, their state is shown as information, not as a problem.

## 3. Auditing Tailscale Serve and Funnel

Yes. Funnel puts a port on this Mac on the public internet through Tailscale's relays, without the firewall or a router seeing it, so it is exactly the kind of exposure the host check exists to find.

| Check | How | Problem when | Severity |
| --- | --- | --- | --- |
| Funnel | `tailscale funnel status --json` (and the `AllowFunnel` part of `tailscale serve status --json`; check the format on the installed version) | anything is funnelled | high |
| Funnel of Porchlight itself | the funnelled target is Porchlight's port | Porchlight's page reachable from the internet | critical: its key then guards it alone, and invariant 7 never meant it for the internet |
| Serve | `tailscale serve status --json` | a served target listens without authentication of its own (shown for review: Serve reaches only the tailnet) | low |
| Serve of Porchlight | the served target is Porchlight's port | — this is a supported setup (an HTTPS proxy in front, Origin host compared); shown as passed | — |

**Later, optional: a Tailscale account audit**, built like the Cloudflare one. A read-only Tailscale API key (kept 0600 beside the report, sent only to `https://api.tailscale.com` as a header, never to the page or a model), and built-in rules for the tailnet policy: an allow-everything rule (`"*"` to `"*:*"`), devices with key expiry turned off, devices not seen for 60 days, reusable or long-lived auth keys, who may use Funnel (`funnel` node attribute), and admins. Read-only by default; any change shown as the exact request and applied only on approval, under invariant 21's rules.

## Order of work

| Phase | What | Effort |
| --- | --- | --- |
| 1 | "VPN and tailnet" in This Mac: Tailscale state, key expiry, exit node, Tailscale SSH, macOS VPN configurations; the Serve and Funnel rules | small to medium |
| 2 | The pages that reach out say which way traffic leaves (part 1, option A) | small |
| 3 | The "expected on" setting (part 2) | small |
| 4 | Tailscale account audit (optional) | medium |

Not recommended: Porchlight routing traffic through a VPN itself, with a toggle or always on.

## What does not change

Rules 2 (passive only), 7 (the tailnet listener), 13 (what a model sees) and 19 (the host check only reads) hold for all of this. Nothing here scans the network or changes a setting.
