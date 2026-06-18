# MCP SSH / Device-Identity Rework

> **Created:** 2026-06-08
> **Status:** Plan (not started) — design for review before building
> **Repo:** `~/Projects/linksys-mcp/` (router-mcp package), config in `~/.config/linksys-mcp/devices.json`
> **Related:** [[MCP-REARCHITECT-PLAN]] (config/tool-registration friction — a DIFFERENT layer)
> **Design goal:** structured + extensible — an identity model with room to grow, not a one-off MAC patch.

---

## Problem (validated 2026-06-08)

You can't reliably tell **what you're connected to** or **what you have access to**.

**Root cause — ambiguous identity:** `devices.json` keys 3 distinct physical devices that ALL share
`host: "192.168.1.1"`:

| serial | model | host | accessMethod | how you pick it today |
|--------|-------|------|--------------|------------------------|
| LK62…1024 | M60-DU (lab) | 192.168.1.1 | ssh | alias "lab" |
| 67A1…0099 | M60CF-EU | 192.168.1.1 | usp-only | alias "EU"/"remote" |
| M60DU-HOME | M60-DU (home) | 192.168.1.1 | ssh | alias "home" |

So identity rests entirely on **manually picking the right alias**, the IP disambiguates nothing, and
**nothing verifies that the box you reached is the one you meant.** Connect to "lab" while the home unit is
on the desk → you're silently operating the wrong router. There is no `mac` field and no verification tool.

## Design principles (so it has room to grow)

1. **Stable hardware identity, not network address.** A device is identified by an immutable key
   (MAC and/or serial), never by IP. IP/host becomes a *connection hint*, not the identity.
2. **Verify on connect (trust-on-first-use + check).** After connecting, read the live hardware identity
   from the box and assert it matches the intended device. Mismatch = loud refusal, not silent wrong-box.
3. **One identity model, many access methods.** SSH, USP/Oktopus, serial console, future cloud-API — each
   is an `accessMethod` on the same device record. Adding a method shouldn't reshape identity.
4. **Self-describing: "what am I connected to / what can I reach"** is a first-class tool, not guesswork.
5. **Fail loud, single source of truth** (carry over from MCP-REARCHITECT-PLAN).

## Proposed structure (extensible schema)

`devices.json` v3 — identity separated from connectivity, capabilities explicit:

```jsonc
{
  "version": 3,
  "devices": [
    {
      "id": "lab-m60du",                 // stable human key (slug), never changes
      "identity": {                       // VERIFIED hardware identity (the source of truth)
        "serial": "LK62DU5Q26001024",
        "mac": "AA:BB:CC:DD:EE:FF",       // primary LAN MAC — the disambiguator
        "model": "M60-DU"
      },
      "connections": [                    // ordered, multiple methods per device
        { "method": "ssh", "host": "192.168.1.1", "port": 22,
          "username": "root", "credentialRef": "LINKSYS_ROUTER_M62_PASS" },
        { "method": "usp", "controller": "oktopus-personal", "endpointId": "..." }
      ],
      "verify": {                         // how to read live identity to confirm the match
        "ssh": "cat /sys/class/net/*/address | head -1",   // or `uci`/`ubus` source
        "expectMac": true, "expectSerial": true
      },
      "aliases": ["lab", "lab device"],
      "tags": ["release-fw", "desk", "ssh-capable"],   // growth: filter/group by capability
      "notes": "Local lab M60 DU variant"
    }
  ]
}
```

Why this shape grows well: identity is one block (add fingerprints later); `connections[]` scales to N access
methods; `tags[]` enables capability queries ("which devices are ssh-capable on corp network"); `verify`
makes the trust check declarative per-method.

## Tooling changes (router-mcp)

Build on the existing `device_list` / `console_connect` / `console_env_check` surface:
- **`device_resolve(idOrAliasOrSerialOrMac)`** — one resolver; ambiguous match = error listing candidates
  (never silently pick).
- **`console_connect`** → after connecting, run the device's `verify` command, compare live MAC/serial to
  `identity`. Mismatch → refuse + report what was actually found. TOFU: first connect records the MAC if absent.
- **`device_whoami`** — "what am I connected to right now": id, model, verified MAC/serial, access method,
  network reachability. Directly answers the pain.
- **`device_access_matrix`** — "what can I reach": per device × method, show reachable/credential-present/
  last-verified. Answers "what do we have access to."
- Health/startup logging (from MCP-REARCHITECT-PLAN) reports identity-verification status per device.

## Device churn — add / swap / retire as first-class workflows

Devices get added and **physically swapped** often (the unit on the desk at `192.168.1.1` changes; a new
model joins the lab). This is the strongest argument for identity-by-hardware + verify-on-connect: **swapping
is exactly when alias-based identity silently lies** — the alias "lab" still resolves, but the box behind
`192.168.1.1` is now a different device. The design must make churn safe and cheap:

- **Add** — `device_add` (TOFU): connect to a host, read live MAC/serial/model, auto-create the record with a
  generated `id`; you just confirm + name it. No hand-editing JSON, no copy-paste of the wrong serial.
- **Swap** — when a connect finds a MAC that doesn't match the record for that host/alias, the verify step
  **detects the swap and refuses**, then offers: "host 192.168.1.1 now reports MAC X (device `home-m60du`),
  not `lab-m60du` — switch target, or register new?" The swap becomes an explicit, logged decision instead of
  a silent mis-operation.
- **Retire** — `device_retire` moves a record to an `archived` block (mirrors the skills `.archive` pattern)
  — kept for history, excluded from active lists/counts. Never hard-delete identity (audit trail).
- **Reuse a host** — because identity ≠ host, N devices can rotate through `192.168.1.1` over time; each keeps
  its own stable `id`/MAC record; the active one is whichever is verified-present right now.

**Schema affordances already support this:** `id` (stable, survives IP changes) + `identity.mac` (the swap
detector) + `connections[]` (a device can move networks without losing identity) + `tags[]` (group/filter as
the fleet grows) + an `archived` section for retired units. Adding a device = append a record; swapping =
verify catches it; no structural change as the fleet scales from 3 → N.

## Phasing (each independently shippable)

1. **Schema v3 + migration** — convert devices.json (add `id`, `identity.mac`, `connections[]`, `tags`,
   `archived`); keep a v2→v3 loader so nothing breaks mid-migration.
2. **Verify-on-connect** — read live MAC/serial post-SSH, assert match, fail loud on mismatch. (Highest-value
   safety win — kills "wrong box silently", and catches swaps.)
3. **device_whoami + device_resolve** — the "what am I connected to" tooling.
4. **Churn workflows** — `device_add` (TOFU autodetect), swap-detection prompt, `device_retire` (→ archived).
5. **device_access_matrix + capability tags** — the "what can I reach" surface.
6. **Extend to USP/console methods** — same identity, more `connections[]`.

## Open questions (resolve at build time)
- MAC source of truth: which interface (LAN bridge vs WAN vs per-radio)? Pick the stable LAN MAC.
- TOFU vs pre-seeded: auto-record MAC on first verified connect, or require manual entry? (Lean TOFU + lock.)
- Does USP expose the same MAC/serial for cross-method identity correlation? (Likely yes via Device.DeviceInfo.)

## Out of scope
- The config/tool-registration friction (router/jenkins/usp tools "connected but not exposed") — that's
  [[MCP-REARCHITECT-PLAN]]. This plan assumes tools register; it fixes *which device they act on*.
