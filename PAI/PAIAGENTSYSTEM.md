# PAI Agent System

**Authoritative reference for agent routing in PAI. Five distinct systems exist—never confuse them.**

---

## 🚨 FIVE AGENT SYSTEMS — CRITICAL DISTINCTION

PAI has five agent systems that serve different purposes. Confusing them causes routing failures.

| System | What It Is | When to Use |
|--------|-----------|-------------|
| **Agent View (Outer Layer)** | Multi-session orchestrator with persistent background agents and worktree isolation | Multi-hour work, sleep-resistant sessions, parallel long-running tasks |
| **Task Tool Subagent Types** | Pre-built agents in Claude Code (Architect, Designer, Engineer, Explore, etc.) | Internal workflow use ONLY |
| **Named Agents** | Persistent identities with backstories and personalities (Serena, Marcus, Rook, etc.) | Recurring work, relationships |
| **Project Agents** | Domain-specific agents with embedded codebase knowledge (`~/.claude/custom-agents/`) | Domain-specific deep work |
| **Custom Agents** | Dynamic agents composed via ComposeAgent from traits | When user says "custom agents" |

---

## Agent View — Outer Orchestration Layer

**Agent View** is Claude Code's multi-session supervisor. It runs multiple independent Claude Code sessions in parallel, each isolated in its own git worktree with persistent state across sleep/wake cycles.

### When to Use Agent View

| Scenario | Use Agent View | Use Intra-Session Task Tool |
|----------|----------------|----------------------------|
| Multi-hour work (> 1 hour) | ✅ Background agent survives sleep | ❌ Session dies on sleep |
| Parallel independent projects | ✅ Full worktree isolation | ❌ Shared working directory |
| Long-running research/builds | ✅ Supervisor keeps process alive | ❌ Lost on terminal close |
| Quick subtasks (< 10 minutes) | ❌ Overhead not worth it | ✅ Fast spawn/return |

**Rule of thumb:** If the work might outlive the current session or needs full git isolation, dispatch via Agent View. Otherwise use Task tool.

### How to Dispatch via Agent View

```bash
# Dispatch a named agent in the background
claude --agent Engineer --bg "Implement OAuth2 flow in auth module"

# Dispatch without a named agent (general-purpose)
claude --bg "Refactor the router package tests"

# Check active agents
claude --roster

# Kill a background agent
claude --kill <agent-id>
```

**State location:** `~/.claude/daemon/roster.json`

### Dispatch-Ready Agents

These agents have `isolation: worktree` in their frontmatter and are optimized for background dispatch:

- **Architect** — System design, architectural planning
- **Engineer** — Code implementation, TDD, micro-cycles
- **StakeholderCommunicator** — Executive summaries, status updates
- **ProductStrategist** — Roadmap planning, feature scoping
- **TechnicalReviewer** — Architecture evaluation, risk assessment

**All other agents** can be dispatched but share the main worktree (no isolation).

### Integration with /goal

Background agents use `/goal` as their convergence mechanism:

1. **At dispatch:** Agent receives a goal statement in the prompt
2. **During work:** Agent periodically checks goal satisfaction via ISC (Ideal State Criteria)
3. **On completion:** Agent writes results to a well-known location and signals completion
4. **Parent session:** Polls for completion signal or waits for notification

#### Writing Effective Goals

A good /goal is **concise, verifiable, and specific**. The agent must be able to mechanically check when the goal is satisfied.

**Good goals:**
- ✅ "All tests in test/auth/ pass and the login page renders without console errors"
- ✅ "PR created with passing CI targeting main branch"
- ✅ "File docs/api-spec.md exists with sections: Overview, Endpoints, Auth, Errors"
- ✅ "grep -r 'TODO' src/ returns no matches"

**Bad goals:**
- ❌ "Fix the auth bug" (not verifiable — how does the agent know when it's fixed?)
- ❌ "Implement the feature" (too vague — what constitutes "done"?)
- ❌ "Make the code better" (unmeasurable — no clear success criterion)
- ❌ "Research X" (open-ended — when is research "complete"?)

**Relationship to ISC:**
- **/goal** is the summary-level condition — the ONE thing that signals completion
- **ISC** (Ideal State Criteria) are the atomic criteria the Algorithm uses internally to check progress
- The agent decomposes the /goal into ISC, works through them, and verifies the /goal is satisfied before signaling completion

**Interactive sessions:**
- Do NOT use /goal when working with a human in the loop
- The human provides the convergence signal ("looks good", "ship it", "try again")
- /goal is for autonomous background work where no human is monitoring

**Example dispatch with goal:**

```bash
claude --agent Architect --bg "Goal: Produce a 3-page system design doc for the new webhook service at ~/Projects/myapp/docs/webhook-design.md. Include: architecture diagram, API spec, security model. Signal completion by touching ~/Projects/myapp/.architect-done"
```

The parent session can monitor `~/.claude/daemon/roster.json` or poll for the `.architect-done` signal.

---

## 🚫 FORBIDDEN PATTERNS

**When user says "custom agents":**

```typescript
// ❌ WRONG - These are Task tool subagent_types, NOT custom agents
Task({ subagent_type: "Architect", prompt: "..." })
Task({ subagent_type: "Designer", prompt: "..." })
Task({ subagent_type: "Engineer", prompt: "..." })

// ✅ RIGHT - Invoke the Agents skill for custom agents
Skill("Agents")  // → CreateCustomAgent workflow
// OR follow the workflow directly:
// 1. Run ComposeAgent with different trait combinations
// 2. Launch agents with the generated prompts
// 3. Each gets unique personality
```

---

## Routing Rules

### Agent View vs Intra-Session Delegation

**First decision:** Outer orchestration (Agent View) or inner delegation (Task tool)?

| User Says | Dispatch Mechanism | Rationale |
|-----------|-------------------|-----------|
| "background", "in the background", "work on X while I..." | `claude --bg` or `claude --agent <name> --bg` | User explicitly wants parallel/persistent work |
| "multi-hour", "long-running", "keep working on" | Agent View dispatch | Work outlives session |
| "spin up Engineer to...", "have Architect work on..." | `Task({ subagent_type: "Engineer" })` | Quick subtask, synchronous return |
| "parallel agents for research" | `Skill("Research")` → Task tool | Skill handles orchestration |

**If Agent View:** Use `claude --agent <name> --bg "<goal statement>"` with explicit ISC in prompt.

**If Task tool:** Continue to routing below.

### The Word "Custom" Is the Trigger

| User Says | Action | Implementation |
|-----------|--------|----------------|
| "**custom agents**", "spin up **custom** agents" | Invoke Agents skill | `Skill("Agents")` → CreateCustomAgent workflow |
| "agents", "launch agents", "parallel agents" | Custom agents via Agents skill | `Skill("Agents")` → ComposeAgent → `Task({ subagent_type: "general-purpose" })` |
| "research X", "investigate Y" | Research skill | `Skill("Research")` → appropriate researcher agents |
| "use Remy", "get Ava to" | Named agent | Use appropriate researcher subagent_type |
| (Code implementation) | Engineer | `Task({ subagent_type: "Engineer" })` |
| (Architecture/design) | Architect | `Task({ subagent_type: "Architect" })` |
| (Domain-specific topic matching your custom agents) | Project agent | Load from `~/.claude/custom-agents/*.md` |

### Custom Agent Creation Flow

When user requests custom agents:

1. **Invoke Agents skill** via `Skill("Agents")` or follow CreateCustomAgent workflow
2. **Run ComposeAgent** for EACH agent with DIFFERENT trait combinations
3. **Extract prompt** from ComposeAgent output
4. **Launch agents** with Task tool using the composed prompts

```bash
# Example: 3 custom research agents
bun run ~/.claude/skills/Agents/Tools/ComposeAgent.ts --traits "research,enthusiastic,exploratory"
bun run ~/.claude/skills/Agents/Tools/ComposeAgent.ts --traits "research,skeptical,systematic"
bun run ~/.claude/skills/Agents/Tools/ComposeAgent.ts --traits "research,analytical,synthesizing"
```

---

## How to Invoke Agents

Three invocation mechanisms exist:

| Mechanism | Syntax | When |
|-----------|--------|------|
| **Agent tool** | `Agent({ subagent_type: "Engineer", prompt: "..." })` | Spawning a pre-built agent from the primary conversation |
| **Agents skill** | `Skill("Agents")` → ComposeAgent | Creating custom agents with unique personalities |
| **Auto-triggered** | Hooks/skills spawn subagents internally | Research skill, QA workflows, development skill |

**Passing context to spawned agents:**
- Agents start with NO context from the parent conversation
- Include: what to do, why, relevant file paths, constraints
- Don't include: conversation history, prior attempts, task management state
- For code tasks: specify the exact files and what to change
- For research: specify the question, not the steps

**Quick reference — "I want X, which agent?"**

| Goal | Use |
|------|-----|
| Implement a feature | `Agent({ subagent_type: "Engineer", prompt: "..." })` |
| Design system architecture | `Agent({ subagent_type: "Architect", prompt: "..." })` |
| Find code in a large repo | `Agent({ subagent_type: "Explore", prompt: "..." })` |
| Research with web sources | `Skill("Research")` or `Skill("Deliberate")` |
| Parallel custom perspectives | `Skill("Agents")` → ComposeAgent with varied traits |
| Security testing | `Agent({ subagent_type: "Pentester", prompt: "..." })` |
| Browser automation/QA | `Agent({ subagent_type: "QATester", prompt: "..." })` |

---

## Task Tool Subagent Types (Internal Use Only)

These are pre-built agents in the Claude Code Task tool. They are for **internal workflow use**, not for user-requested "custom agents."

| Subagent Type | Purpose | When Used |
|---------------|---------|-----------|
| `Architect` | System design | Development skill workflows |
| `Designer` | UX/UI design | Development skill workflows |
| `Engineer` | Code implementation | Development skill workflows |
| `general-purpose` | Custom agents via ComposeAgent | Parallel work with task-specific prompts |
| `Explore` | Codebase exploration | Finding files, understanding structure |
| `Plan` | Implementation planning | Plan mode |
| `QATester` | Quality assurance | Browser testing workflows |
| `Pentester` | Security testing | WebAssessment workflows |
| `ClaudeResearcher` | Claude-based research | Research skill workflows |
| `GeminiResearcher` | Gemini-based research | Research skill workflows |
| `GrokResearcher` | Grok-based research | Research skill workflows |

**These do NOT use ComposeAgent composition.**

---

## Named Agents (Persistent Identities)

Named agents have rich backstories and personality traits. They provide relationship continuity across sessions.

| Agent | Role | Use For |
|-------|------|-------|---------|
| Serena Blackwood | Architect | Premium UK Female | Long-term architecture decisions |
| Marcus Webb | Engineer | Premium Male | Strategic technical leadership |
| Rook Blackburn | Pentester | Enhanced UK Male | Security testing with personality |
| Ava Sterling | Claude Researcher | Premium US Female | Strategic research |
| Alex Rivera | Gemini Researcher | Multi-perspective | Comprehensive analysis |

**Full backstories:** Individual `agents/*.md` files (persona frontmatter + body)

---

## Project Agents (Domain-Specific Persistent Agents)

Project agents are manually authored agents with deep domain knowledge embedded. They live in `~/.claude/custom-agents/` with `custom_agent: true` frontmatter and are available globally across all PAI projects.

### Creating Domain-Specific Project Agents

Project agents are the most powerful customization point in KAI. Each agent embeds deep knowledge about a specific domain — a codebase, a product, a technology stack.

**To create your own project agent:**
1. Create `~/.claude/custom-agents/YourDomain-Role.md`
2. Add frontmatter: `custom_agent: true`, `model: opus`, `triggers: [keyword list]`
3. Write a system prompt embedding the domain knowledge you want the agent to carry
4. The agent is available globally across all KAI sessions when a matching trigger topic is detected

**Example agent structure:**
```markdown
---
custom_agent: true
model: opus
triggers: [your-domain, your-technology, your-product]
---

You are a specialist in [DOMAIN]. Your knowledge covers:
- [Area 1]
- [Area 2]

Key context: [embed the context that would otherwise need to be re-established every session]
```

**See `skills-examples/` for domain-specific skill templates** that show how to structure specialized workflow skills alongside project agents.

---

## Custom Agents (Dynamic Composition)

Custom agents are composed on-the-fly from traits using ComposeAgent. Each unique trait combination generates a distinct personality.

### Trait Categories

**Expertise** (domain knowledge):
`security`, `legal`, `finance`, `medical`, `technical`, `research`, `creative`, `business`, `data`, `communications`

**Personality** (behavior style):
`skeptical`, `enthusiastic`, `cautious`, `bold`, `analytical`, `creative`, `empathetic`, `contrarian`, `pragmatic`, `meticulous`

**Approach** (work style):
`thorough`, `rapid`, `systematic`, `exploratory`, `comparative`, `synthesizing`, `adversarial`, `consultative`

|-------------|-------|-----|
| contrarian + skeptical | Clyde (gravelly) | Challenging intensity |
| enthusiastic + creative | Jeremy (energetic) | High-energy creativity |
| security + adversarial | Callum (edgy) | Hacker character |
| analytical + meticulous | Charlotte (sophisticated) | Precision analysis |

**Full trait definitions:** `skills/Agents/Data/Traits.yaml`

---

## Model Selection

Always specify the appropriate model for agent work:

| Task Type | Model | Speed |
|-----------|-------|-------|
| Simple checks, grunt work | `haiku` | 10-20x faster |
| Standard analysis, implementation | `sonnet` | Balanced |
| Deep reasoning, architecture | `opus` | Maximum intelligence |

```typescript
// Parallel custom agents benefit from haiku/sonnet for speed
Task({ prompt: agentPrompt, subagent_type: "general-purpose", model: "sonnet" })
```

---

## Spotcheck Pattern

**Always launch a spotcheck agent after parallel work:**

```typescript
Task({
  prompt: "Verify consistency across all agent outputs: [results]",
  subagent_type: "general-purpose",
  model: "haiku"
})
```

---

## References

- **Agents Skill:** `skills/Agents/SKILL.md` — Custom agent creation, workflows
- **ComposeAgent:** `skills/Agents/Tools/ComposeAgent.ts` — Dynamic composition tool
- **Traits:** `skills/Agents/Data/Traits.yaml` — Trait definitions
- **Agent Personalities:** Individual `agents/*.md` files — Named agent backstories

---

## Agent View State Management

**Roster location:** `~/.claude/daemon/roster.json`

**Per-agent state includes:**
- Agent ID (unique identifier)
- Named agent (if dispatched via `--agent <name>`)
- Worktree path (if isolated)
- Goal statement (for /goal convergence)
- Spawn time, last activity timestamp
- Supervisor PID

**Monitoring active agents:**

```bash
# List all active agents
claude --roster

# Show detailed state for one agent
cat ~/.claude/daemon/roster.json | jq '.agents[] | select(.id == "abc123")'

# Kill an agent
claude --kill <agent-id>
```

**Integration with PAI hooks:** The `SessionStart` hook can check roster state and prompt the user if background agents completed work since the last session.

---

*Last updated: 2026-05-28*
