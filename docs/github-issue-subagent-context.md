## [FEATURE] Opt-in context inheritance for Agent-spawned subagents (`inherit_context` flag)

### Preflight Checklist

- [x] I have searched existing issues (#6825, #4908, #50093, #40459, #41356) and this proposes a concrete solution to a problem previously closed without resolution
- [x] This is a single feature request
- [x] I am using the latest version of Claude Code

### Problem Statement

**Agent-spawned subagents silently discard all project context, causing permanent knowledge loss in multi-agent workflows.**

When a parent session delegates work via the Agent tool, subagents start with zero project context:
- No `~/.claude/CLAUDE.md`
- No `.claude/rules/`
- No project memory
- No hooks fire (SessionStart, PreToolUse, PostToolUse — confirmed by #69260 filed today)

This is by design for token efficiency. **But there is no opt-in path** for workloads where context inheritance is critical.

### Real-World Impact (Forensic Data)

I operate a hooks-based memory system where the parent session is instructed to persist important findings to project memory. After a 9-day period of active development on a project:

- **296 subagent sessions** were spawned via Agent tool (sdk-cli/queue-operation)
- **4 interactive sessions** existed (cli/typed) — all from the final day
- **Zero project memories** were persisted across 9 days of work
- The parent sessions saved brief summaries to their own project directory (CWD-based), not the target project
- Subagents performed the substantive work (research, bug fixes, PR submissions) but couldn't persist anything

**Result:** When I opened the project directly the next day, Claude had zero recall of 9 days of work — including merged PRs, workflow patterns, and architectural decisions.

### The Token Efficiency Trade-off Is Currently All-or-Nothing

Prior issues (#6825) correctly identified that inheriting everything (60K+ tokens) for a trivial `echo success` subagent is wasteful. Anthropic's response was to strip ALL context from subagents.

But this created the inverse problem: **subagents that DO need project rules get nothing**. There's no middle ground.

The community has converged on brittle workarounds:
- Manually embedding rules in every Agent prompt (verbose, error-prone, duplicative)
- External hook-patching tools (j-p-c/alzheimer, rtk-ai/rtk)
- Binary patches to the `omitClaudeMd` flag (#40459)

### Proposed Solution: `inherit_context` Flag

Add an optional parameter to the Agent tool call:

```
Agent(
    prompt="...",
    inherit_context: "none" | "rules" | "full"
)
```

**Three tiers:**

| Level | What's Inherited | Token Cost | Use Case |
|-------|-----------------|-----------|----------|
| `"none"` (default) | Nothing — current behavior | ~3K base | Quick lookups, grep, simple ops |
| `"rules"` | CLAUDE.md + .claude/rules/ + project memory index | ~10-30K typical | Agents that must follow project conventions, safety rules, memory instructions |
| `"full"` | Everything the parent has (CLAUDE.md, rules, memory, MCP tool descriptions) | ~60K+ | Long-running research agents, workflow agents that need full context |

**Why a flag, not a global setting:**
- Different subagents in the SAME session need different levels. An Explore agent grepping for a symbol doesn't need 60K of context. A research agent building a PR needs all the project rules.
- The parent agent is best positioned to decide — it knows what work it's delegating.
- Backward-compatible: default `"none"` preserves current token-efficient behavior.

### Alternative: Hook Inheritance Flag

Separately from CLAUDE.md content, hooks are also stripped from subagents (ref: #69260). A companion flag:

```
Agent(
    prompt="...",
    inherit_hooks: true | false
)
```

This would allow PreToolUse safety hooks (SecurityValidator, rate-limit enforcement) to fire for subagent tool calls. The token cost is zero (hooks are code, not prompt tokens) — only execution time.

### Why This Matters More Than It Did in 2025

The Agent tool is used aggressively by newer models (Opus 4.x, Sonnet 4.x). In observed workflows:
- 70-95% of sessions in a project are subagents
- Subagents do the majority of substantive work
- The parent is increasingly an orchestrator, not an executor

Without context inheritance, the majority of actual work happens in a context-free void. This makes:
- Memory systems useless (can't save, can't recall)
- Safety hooks bypassable (don't fire in subagents)
- Project conventions invisible (not in prompt)
- Multi-session continuity impossible (knowledge dies with each subagent)

### References

| Issue | Topic | Status |
|-------|-------|--------|
| #6825 | Configurable inheritance (proposed `includes:` syntax) | Closed (dup → #4908) |
| #4908 | Scoped context passing | Closed (NOT_PLANNED) |
| #50093 | Optional inherit CLAUDE.md + rules | Closed (NOT_PLANNED) |
| #40459 | `omitClaudeMd:true` regression analysis | Closed (NOT_PLANNED) |
| #41356 | Memory rules violated by subagents | Closed (NOT_PLANNED) |
| #69260 | PreToolUse hooks don't fire for subagents | **OPEN (today)** |
| #55648 | Subagent skips task when writing memory | Closed |

### Environment

- Claude Code version: 2.1.179+
- Platform: macOS (Darwin 24.6.0)
- Model: Opus 4.6 (via Bedrock)
- Workflow: ~300 subagent sessions across 9 days, 4 interactive sessions
