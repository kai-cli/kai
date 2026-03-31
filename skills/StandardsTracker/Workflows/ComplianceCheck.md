# ComplianceCheck Workflow

**Trigger:** "compliance check", "are we compliant", "TR-369 compliance", "standards compliance", "USP compliance"

## Purpose

Assess Pinnacle product line compliance against current TR-369/USP and TR-069/CWMP specifications. Produces a gap analysis that can feed into sprint planning or leadership updates.

## Process

### 1. Load Current Spec State

```bash
cat ~/.claude/skills/StandardsTracker/State/last-check.json
```

Get known spec versions to assess against.

### 2. Load Product Context

Read Pinnacle project context:
- Check `~/.claude/PAI/USER/PROJECTS/` for Pinnacle project files
- Determine which releases are active (2.0, 2.1, 2.2, 3.0)
- Identify any previously logged compliance decisions from DecisionLog

### 3. Fetch Current Spec Requirements

For the active specs, identify mandatory and optional requirements:

**TR-369 (USP) Compliance Areas:**

| Area | Requirement | Status |
|------|------------|--------|
| **Protocol** | USP Record/Message encoding (Protobuf) | |
| **MTP** | At least one MTP (WebSocket, STOMP, MQTT, CoAP) | |
| **Security** | TLS 1.2+, certificate-based auth | |
| **Data Model** | Device:2.x baseline profile support | |
| **Operations** | Get, Set, Add, Delete, Operate, Notify | |
| **Bulk Data** | BulkData collection profile | |
| **Firmware** | Firmware image download and activation | |
| **Reboot/Reset** | Device.Reboot(), Device.FactoryReset() | |
| **Wi-Fi** | Device.WiFi.* data model objects | |
| **EasyMesh** | Device.WiFi.DataElements.* (if EasyMesh supported) | |

**TR-069 (CWMP) Compliance Areas:**

| Area | Requirement | Status |
|------|------------|--------|
| **Protocol** | SOAP/HTTP(S) with ACS communication | |
| **Security** | SSL/TLS, HTTP authentication | |
| **RPC Methods** | GetParameterValues, SetParameterValues, etc. | |
| **Data Model** | InternetGatewayDevice or Device:2 profile | |
| **Firmware** | Download and firmware upgrade | |
| **Diagnostics** | IPPing, TraceRoute, DSL diagnostics | |

### 4. Assess Each Pinnacle Release

For each active release, fill in compliance status:

| Status | Meaning |
|--------|---------|
| PASS | Implemented and tested |
| PARTIAL | Implemented but incomplete or untested |
| GAP | Not implemented, required by spec |
| N/A | Not applicable to this product |
| UNKNOWN | Need to verify with engineering team |

### 5. Generate Gap Report

```markdown
# Compliance Assessment — Pinnacle [Release]
**Assessed Against:** TR-369 v[X.X], TR-181 v[X.X], TR-069 v[X.X]
**Date:** [timestamp]

## Summary
| Standard | Status | Pass | Partial | Gap | Unknown |
|----------|--------|------|---------|-----|---------|
| TR-369 | [overall] | X | X | X | X |
| TR-069 | [overall] | X | X | X | X |

## Gaps Requiring Action
| # | Area | Spec Requirement | Current State | Effort | Priority |
|---|------|-----------------|---------------|--------|----------|
| 1 | [area] | [requirement] | [state] | [S/M/L] | [H/M/L] |

## Questions for Engineering
1. [Specific question about an UNKNOWN area]
2. [Specific question about a PARTIAL implementation]

## Recommendation
[2-3 sentences: overall compliance posture, top risks, suggested next steps]
```

### 6. Output

Present the gap report. If significant gaps found, suggest:
- Which gaps to address in current release vs. defer to 3.0
- Questions to bring to engineering team
- Whether a standards review meeting is warranted
