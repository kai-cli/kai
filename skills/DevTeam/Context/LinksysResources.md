# YourCompany Project Resources

Available resources for DevTeam agents working on YourCompany/ExampleWRT firmware:

## Repository Access

- **ExampleWRT-Firmware**: `~/Projects/ExampleWRT-Firmware/`
  - Git repo: `feed_yourcompany/.git` (subpackages live under `feed_yourcompany/`)
  - Key packages: `guest-access`, `nodes`, `lrhk`, `topomgr`, `jnap`, `lldp`
  - Build system: OpenWrt feed with per-package Makefiles

## Knowledge Base

- **YourCompany Wiki**: `~/Projects/YourCompany-Wiki/` (81-page Obsidian vault)
  - Full indexed knowledge base covering architecture, daemons, protocols
  - Topics: USP/CWMP, mesh topology, JNAP API, guest access, sysevent, firmware OTA
  - Access via WikiQuery skill or direct file reads

## MCP Tools (yourcompany-mcp)

Available via MCP server when connected to a device:
- `router_exec` — Run commands on target router
- `router_logs` — Pull and filter syslogs
- `router_config_diff` — Compare running vs saved config
- `router_process_check` — Check if daemon is running
- `router_interfaces` — List network interfaces
- `router_health` — Overall device health check
- `router_uci_get/set` — Read/write UCI configuration

## How Agents Should Use These

1. **Investigation phase**: Search the wiki for daemon architecture context. Use `router_logs` and `router_process_check` to observe live behavior.
2. **Dev phase**: Use git history in `feed_yourcompany/.git` for understanding prior changes. Reference wiki for design intent.
3. **QA phase**: Use `router_exec` to test on actual hardware if available. Use `router_config_diff` to verify no unintended changes.
4. **Review phase**: Wiki provides authoritative context for "is this the right approach?" questions.
