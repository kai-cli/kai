# PAI 4.6.0 — Development Workspace

Staged development for PAI v4.6.0. Changes here are tested and reviewed before going into `~/.claude/`.

## v4.5.0 Summary (shipped 2026-03-26)

Ralph Loop autonomous execution, multi-agent orchestrator, kanban board, security hardening (SecretScanner, SecurityValidator Glob/Grep, patterns.yaml), workflow frameworks mining, safety hooks evaluation.

## v4.6.0 Focus: Reliability + Intelligence

4.5.0 proved PAI can execute autonomously (Ralph Loop). 4.6.0 makes it **reliable and smart** — fixing budget exhaustion, adding session handoff, building a research index, and adopting the best patterns mined from community frameworks.

## Planned Tasks

| # | Task | Source | Priority | Effort |
|---|------|--------|----------|--------|
| 1 | Ralph Loop budget + reliability tuning | 4.5.0 learnings | P0 | Standard |
| 2 | Session handoff protocol | Roadmap WS5 | P1 | Extended |
| 3 | Research index + agent context seeding | Roadmap WS2 | P1 | Standard |
| 4 | Phase-locked tool access (RIPER pattern) | Frameworks mining #1 | P1 | Standard |
| 5 | Triangulation verification sub-protocol | Frameworks mining #2 | P1 | Standard |
| 6 | Context-per-task bundling for Ralph Loop | Frameworks mining #3 | P1 | Extended |
| 7 | WebFetch/WebSearch PreToolUse guard | Safety eval R3 | P1 | Standard |
| 8 | PostToolUse code quality gate | Safety eval R4 | P1 | Standard |
| 9 | Architectural Decision Records | Frameworks mining #4 | P2 | Standard |
| 10 | Project state snapshots | Frameworks mining #5 | P2 | Standard |
| 11 | Skill collections additions | Deferred from 4.5.0 | P2 | Extended |
| 12 | Board write capability (phase, ISC, Ralph Loop trigger) | Board usage | P1 | Extended |
| 13 | Board config persistence (scan dirs, startup) | Board usage | P2 | Standard |

## Deploy to Live PAI

When a change is ready:
1. Copy modified files from the relevant subdirectory to `~/.claude/`
2. Update version in `~/.claude/CLAUDE.md` header to `4.6.0`
3. Restart Claude Code session to pick up changes

## Structure

```
docs/v46-staging/
├── STAGING-README.md       # This file
├── STAGING-CHANGELOG.md    # What's changing in 4.6.0
└── work/                   # PRDs for individual tasks
```
