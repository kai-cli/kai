---
name: Automate
description: Launch, define, and track autonomous headless Claude agents with tool whitelists. USE WHEN automate, launch agent, run autonomous, headless claude, background task, check agents, agent status, define automation, automation profile.
---

# Automate

Launch autonomous Claude agents with pre-defined tool access. No babysitting.

## Workflow Routing

| Trigger | Workflow |
|---------|----------|
| "launch", "run", "start", profile name | `Workflows/Launch.md` |
| "define", "create profile", "new automation" | `Workflows/Define.md` |
| "status", "check agents", "what's running" | `Workflows/Status.md` |
| "stop", "kill", "cancel" | `Workflows/Stop.md` |
| "list profiles", "show automations" | `Workflows/List.md` |

## Quick Reference

**Profiles live at:** `~/.claude/automations/`
**Each profile is a JSON file:**
```json
{
  "name": "jenkins-monitor",
  "description": "Check Jenkins builds, summarize failures",
  "prompt": "Check recent Jenkins builds. Summarize any failures with root cause analysis.",
  "allowedTools": ["mcp__jenkins__*"],
  "cwd": "~/Projects/Automation",
  "permissionMode": "auto",
  "model": "sonnet"
}
```

**Launch inline:** `/automate run jenkins-monitor`
**Launch ad-hoc:** `/automate run "check device health" --tools mcp__router__*`
