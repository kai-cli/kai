# Claude Code Hooks: Community Landscape Research

> Research Date: 2026-03-26
> Researcher: Ava Sterling (ClaudeResearcher)
> Scope: External community implementations of Claude Code hooks

---

## 1. Official Hook System Reference

Claude Code exposes **24+ hook events** across six categories:

| Category | Events |
|----------|--------|
| **Session Lifecycle** | `SessionStart`, `SessionEnd`, `InstructionsLoaded` |
| **User Input** | `UserPromptSubmit` |
| **Tool Execution** | `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest` |
| **Agent/Team** | `SubagentStart`, `SubagentStop`, `TeammateIdle`, `TaskCreated`, `TaskCompleted` |
| **Workflow Control** | `Stop`, `StopFailure`, `Notification` |
| **Environment** | `ConfigChange`, `CwdChanged`, `FileChanged`, `WorktreeCreate`, `WorktreeRemove`, `PreCompact`, `PostCompact` |
| **MCP** | `Elicitation`, `ElicitationResult` |

**Hook handler types:** `command` (shell), `http` (POST endpoint), `prompt` (LLM eval), `agent` (subagent spawn)

**Key exit codes:** `0` = success, `2` = blocking error, other = non-blocking error

**PreToolUse decisions:** `allow`, `deny`, `ask` (via `hookSpecificOutput.permissionDecision`)

---

## 2. Repository Catalog

### Tier 1: Major Repositories (1000+ stars)

| Repository | Stars | Language | Focus |
|-----------|-------|----------|-------|
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | 32.7k | Python | Curated list of skills, hooks, slash-commands, plugins |
| [parcadei/Continuous-Claude-v3](https://github.com/parcadei/Continuous-Claude-v3) | 3.6k | Python | 30-hook context management system |
| [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) | 3.4k | Python | Complete 13-hook lifecycle tutorial |
| [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) | 1.3k | Python | Real-time 12-hook monitoring dashboard |
| [ComposioHQ/awesome-claude-plugins](https://github.com/ComposioHQ/awesome-claude-plugins) | 1.2k | - | Curated plugins including hooks |

### Tier 2: Notable Repositories (50-999 stars)

| Repository | Stars | Language | Focus |
|-----------|-------|----------|-------|
| [rohitg00/awesome-claude-code-toolkit](https://github.com/rohitg00/awesome-claude-code-toolkit) | 907 | JS | 19 hooks among 150+ plugins |
| [ccplugins/awesome-claude-code-plugins](https://github.com/ccplugins/awesome-claude-code-plugins) | 647 | Python | Curated hooks + slash commands |
| [karanb192/claude-code-hooks](https://github.com/karanb192/claude-code-hooks) | 301 | JS | Practical hook collection with safety levels |
| [starbaser/ccproxy](https://github.com/starbaser/ccproxy) | 191 | Python | Request interception proxy with hooks |
| [GowayLee/cchooks](https://github.com/GowayLee/cchooks) | 125 | Python | Python SDK for hook development |
| [beyondcode/claude-hooks-sdk](https://github.com/beyondcode/claude-hooks-sdk) | 62 | PHP | PHP SDK for hooks |

### Tier 3: Specialized / Emerging

| Repository | Stars | Language | Focus |
|-----------|-------|----------|-------|
| [coo-quack/sensitive-canary](https://github.com/coo-quack/sensitive-canary) | 10 | TypeScript | Secrets & PII guard (24 secret rules, 7 PII rules) |
| [mattzcarey/awesome-agent-hooks](https://github.com/mattzcarey/awesome-agent-hooks) | 10 | Shell | Quality hooks for Claude Code + OpenCode |
| [ithiria894/awesome-claude-code-hooks](https://github.com/ithiria894/awesome-claude-code-hooks) | 7 | - | Curated hook collection |
| [lucianfialho/awesome-claude-code-hooks](https://github.com/lucianfialho/awesome-claude-code-hooks) | 4 | - | One-command installable hooks |

---

## 3. Hook Patterns by Category

### SAFETY & SECURITY

| Pattern | Hook Event | What It Does | Source |
|---------|-----------|-------------|--------|
| **Block destructive commands** | `PreToolUse` (Bash) | Denies `rm -rf`, fork bombs, `curl\|sh` | karanb192, disler, beyondcode |
| **Protect secrets/env files** | `PreToolUse` (Read/Edit/Write/Bash) | Blocks reading/modifying `.env`, credentials, OAuth keys | karanb192, disler, cchooks |
| **PII/secrets scanning** | `UserPromptSubmit` + `PreToolUse` | Scans prompts and tool inputs for AWS keys, API tokens, SSNs, credit cards (Luhn-validated), emails, phone numbers; 24 secret rules + 7 PII rules derived from gitleaks/TruffleHog | sensitive-canary |
| **Entropy-based secret detection** | `UserPromptSubmit` | High-entropy string filtering to catch unknown secret formats | sensitive-canary |
| **Prompt security filtering** | `UserPromptSubmit` | Validates/filters prompts for credential exposure (e.g., blocks "password" in prompts) | disler, cchooks |
| **Permission auditing** | `PermissionRequest` | Logs all permission requests; auto-allows read-only tools (Read, Glob, Grep) | disler |
| **Block dynamic imports** | `PreToolUse` (Write/Edit) | Prevents dynamic `import()` calls that enable runtime code injection | mattzcarey |
| **Header/credential redaction** | Request hooks | Redacts sensitive values in logged HTTP headers | ccproxy |
| **Configurable safety levels** | Various | Three tiers: Critical (catastrophic only), High (risky actions), Strict (maximum) | karanb192 |
| **User bypass tags** | `UserPromptSubmit` / `PreToolUse` | `[allow-secret]` or `[allow-all]` tags to intentionally bypass blocks | sensitive-canary |

### OBSERVABILITY & AUDIT

| Pattern | Hook Event | What It Does | Source |
|---------|-----------|-------------|--------|
| **Real-time monitoring dashboard** | All 12 events | Pipeline: Hooks -> HTTP POST -> Bun/SQLite -> WebSocket -> Vue client; live pulse chart, session color coding, multi-criteria filtering | disler (observability) |
| **Event logging** | All events | Logs all hook events to inspect payload structures | karanb192 |
| **Transcript extraction** | `PostToolUse` | Converts JSONL transcripts to readable JSON | disler (mastery) |
| **Error logging** | `PostToolUseFailure` | Structured error capture with full context | disler (mastery) |
| **Transcript backup** | `PreCompact` | Creates full transcript backup before context compaction | disler (mastery) |
| **Session tracking** | `SessionStart`/`SessionEnd` | Model, source, and lifecycle tracking with cleanup | disler (observability) |
| **Request capture for LangFuse** | Request hooks | Extracts session IDs and headers for LangFuse trace metadata | ccproxy |

### PRODUCTIVITY & AUTOMATION

| Pattern | Hook Event | What It Does | Source |
|---------|-----------|-------------|--------|
| **Auto git-stage** | `PostToolUse` (Edit/Write) | Automatically `git add` files after Claude modifies them | karanb192 |
| **Desktop notifications** | `Notification` | Alerts when Claude needs input or completes tasks; one-click VS Code jump | cc-notify (awesome-claude-code) |
| **Slack alerts** | `Notification` (permission_prompt/idle_prompt) | Sends Slack messages when Claude needs user attention | karanb192 |
| **Dev context loading** | `SessionStart` | Loads git status, open issues, recent files at session start | disler |
| **TTS completion announcements** | `Stop` | AI-generated completion summaries read aloud (ElevenLabs > OpenAI > pyttsx3 priority) | disler |
| **Subagent announcements** | `SubagentStart`/`SubagentStop` | Audio notifications for multi-agent lifecycle events | disler |
| **Session cleanup** | `SessionEnd` | Temp file removal and resource cleanup | disler |

### QUALITY & VALIDATION

| Pattern | Hook Event | What It Does | Source |
|---------|-----------|-------------|--------|
| **Duplicate function detection** | `PostToolUse` (Write/Edit) | Warns when creating functions that already exist in codebase | mattzcarey |
| **Shift-left validation** | `PostToolUse` (Edit) | Runs pyright/ruff linters immediately after code edits | Continuous-Claude-v3 |
| **British English conversion** | `PostToolUse` (Write) | Converts American to British spellings in comments/docstrings only | Britfix (awesome-claude-code) |
| **Team-based validation** | `Stop` | Builder/Validator agent pattern for output quality gates | disler |
| **Quality audit gate** | `Stop` | Independent quality gate with quick + deep audit modes | Bouncer (awesome-claude-code-toolkit) |

### CONTEXT MANAGEMENT

| Pattern | Hook Event | What It Does | Source |
|---------|-----------|-------------|--------|
| **30-hook context system** | Multiple | YAML handoffs, TLDR code summaries (95% token savings), continuity ledgers, PostgreSQL memory with vector embeddings | Continuous-Claude-v3 |
| **Skill activation injection** | `PreToolUse` | Injects skill context and code summaries before Claude responds | Continuous-Claude-v3 |
| **Handoff indexing** | `PostToolUse` | Tracks handoffs and dirty flags for context continuity | Continuous-Claude-v3 |
| **Pre-compaction rules** | `PreCompact` | Custom transcript compaction rules to preserve critical context | cchooks |

### MULTI-AGENT COMMUNICATION

| Pattern | Hook Event | What It Does | Source |
|---------|-----------|-------------|--------|
| **Inter-agent messaging** | Custom | @-mention targeting between subagents with live dashboard | HCOM (awesome-claude-code) |
| **Agent lifecycle tracking** | `SubagentStart`/`SubagentStop` | Monitors multi-agent team activity | disler (observability) |

### MODEL ROUTING & INFRASTRUCTURE

| Pattern | Hook Event | What It Does | Source |
|---------|-----------|-------------|--------|
| **Dynamic model routing** | Request hooks | Routes requests to different LLM providers based on rules (token count, tool matching) | ccproxy |
| **OAuth forwarding** | Request hooks | Multi-provider credential routing | ccproxy |

---

## 4. SDK & Framework Ecosystem

| SDK | Language | Hook Types | Key Feature |
|-----|----------|-----------|-------------|
| **cchooks** | Python | 9 types | `create_context()` one-liner, type-safe, eliminates JSON boilerplate |
| **claude-hooks-sdk** | PHP | 4 types | Fluent chainable API (Laravel-style), `block()`/`approve()`/`suppressOutput()` |
| **claude-code-hooks-mastery** | Python (UV) | 13 types | UV single-file scripts with embedded deps, no venv needed |

---

## 5. Strategic Analysis

### Second-Order Effects

1. **Security hooks create a false sense of safety.** Pattern-matching for `rm -rf` is trivially bypassed (`rm -r -f`, `find . -delete`). The sensitive-canary approach (entropy + known patterns from gitleaks/TruffleHog) is more robust but still not exhaustive. Hooks are a defense layer, not a security boundary.

2. **The observability gap is closing fast.** Six months ago, Claude Code was a black box. Now disler's monitoring dashboard provides full lifecycle visibility. This shifts the conversation from "can we trust AI agents?" to "what telemetry do we need?"

3. **Context management hooks are the sleeper category.** Continuous-Claude-v3's 30-hook system with 95% token savings via AST-based summaries points to hooks as the primary mechanism for long-running agent sessions. This is where the most architectural innovation is happening.

4. **SDK fragmentation is a risk.** Python (cchooks), PHP (beyondcode), Shell (mattzcarey) -- no dominant TypeScript SDK yet despite TypeScript being the natural fit for the Node.js-based Claude Code ecosystem. This is a gap worth filling.

5. **The "awesome list" ecosystem is saturated.** Five separate awesome-* repositories with overlapping content suggests the community needs consolidation, not more lists.

### Patterns NOT Yet Seen (Opportunities)

- **Rate limiting hooks** -- No community implementation of request/tool rate limiting
- **Cost tracking hooks** -- No per-session cost estimation via token counting
- **Compliance logging** -- No SOC2/HIPAA-oriented audit trail hooks
- **Diff review hooks** -- No pre-commit code review gate using an LLM judge
- **Rollback hooks** -- No automatic git checkpoint before destructive operations
- **Network egress control** -- No hooks blocking outbound network calls to unexpected domains

---

## 6. Key Takeaways for PAI

1. **PAI's PRDSync hook (PostToolUse) is architecturally aligned** with the community pattern of using PostToolUse for state management and indexing.

2. **Safety hooks should be layered**: prompt-level (UserPromptSubmit) + tool-level (PreToolUse) + output-level (PostToolUse/Stop). Single-layer protection is insufficient.

3. **TypeScript hooks are underrepresented** in the community. Only sensitive-canary uses TypeScript. This is an opportunity for PAI to lead.

4. **The `prompt` and `agent` hook handler types are underexplored.** Almost all community hooks use `command` type. LLM-as-judge hooks (`prompt` type) and subagent verification (`agent` type) are powerful but no one is building them yet.

5. **sensitive-canary's approach** (gitleaks/TruffleHog patterns + entropy + Luhn validation) is the most sophisticated security implementation found. Worth studying for PAI's own security hooks.

---

## Sources

All repositories accessed 2026-03-26 via GitHub. Official hook documentation at https://code.claude.com/docs/en/hooks.
