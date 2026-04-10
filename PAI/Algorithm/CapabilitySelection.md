## Capability Selection

**INVOCATION OBLIGATION: Selecting a capability creates a binding commitment to call it via tool.** Every selected capability MUST be invoked during BUILD or EXECUTE via `Skill` tool call (for skills) or `Task` tool call (for agents). Text-only output that resembles a skill's work does NOT count as invocation. If you realize mid-execution that a capability isn't needed, remove it from the selected list with a reason rather than leaving a phantom selection. Selecting zero capabilities is valid when direct tool use is optimal — the goal is the best result, not the most tool calls.

SELECTION METHODOLOGY:

1. Fully understand the task from the reverse engineering step.
2. Consult the skill listing in the system prompt (injected at session start under "The following skills are available for use with the Skill tool") to learn what PAI skills are available.
3. Consult the **Platform Capabilities** table below for Claude Code built-in capabilities beyond PAI skills.
4. SELECT capabilities across BOTH sources. Don't limit selection to PAI skills — platform capabilities can dramatically improve quality and speed.

PLATFORM CAPABILITIES (consider alongside PAI skills):

| Capability | When to Select | Invoke |
|------------|---------------|--------|
| /simplify | After code changes — 3 agents review quality, reuse, efficiency | `Skill("simplify")` |
| /batch | Parallel changes across many files with worktree isolation | `Skill("batch", "instruction")` |
| /debug | Session behaving unexpectedly — reads debug log | `Skill("debug")` |
| /review | Review a PR for quality, security, tests | Describe: "review this PR" |
| /security-review | Analyze pending changes for security vulnerabilities | Describe: "security review" |
| Agent Teams | Complex multi-agent work needing coordination + shared tasks | `TeamCreate` + `Agent` with team_name |
| Worktree Isolation | Parallel dev work — each agent gets isolated file system | `Agent` with `isolation: "worktree"` |
| Background Agents | Non-blocking parallel research or exploration | `Agent` with `run_in_background: true` |
| Competing Hypotheses | Debugging with multiple possible causes | Spawn N agents, each testing one theory |
| Writer/Reviewer | Code quality via role separation | One agent writes, separate agent reviews |

/simplify should be near-default for any code-producing Algorithm run. /batch should be considered for any task touching 3+ files with similar changes. Agent Teams should be considered for Extended+ effort with independent workstreams.

DECISION CRITERIA — When is each capability type better than direct tool use?

| Capability Type | Use When | Don't Use When |
|----------------|----------|---------------|
| **Research** | Answer requires information NOT in the codebase or your training data. Multiple sources needed. | The answer is in the code, git history, or a file you can read directly. |
| **Council / RedTeam** | Decision has 3+ valid approaches with different tradeoffs. Need adversarial stress-testing. | Decision is straightforward or has an obvious best path. |
| **FirstPrinciples** | Stated constraints may not be real constraints. Need to challenge assumptions. | Constraints are clear and well-understood. |
| **IterativeDepth** | Problem benefits from multiple structured analytical angles. Complex system review. | Single-angle analysis is sufficient. |
| **Agents (parallel)** | 3+ independent workstreams exist. Research from multiple sources. | Work is sequential or has tight data dependencies. |
| **Explore agent** | Broad codebase question spanning many files/patterns. | You know the specific file or function to read. |
| **/simplify** | After code changes — reviews quality, reuse, efficiency. Near-default for code tasks. | No code was written or changed. |
| **/batch** | Same change across 3+ files. Codebase-wide refactor. | Changes are unique per file or only touch 1-2 files. |
| **Custom Agents** | Need domain expertise the base model lacks. Role-specific perspective. | General-purpose reasoning is sufficient. |
| **Direct tool use (zero capabilities)** | Task is file reading, editing, running commands with known inputs. Surgical code changes. Well-scoped implementation. | Task requires external information, deep analysis, or parallel workstreams. |

Selecting zero capabilities is valid when direct tool use is optimal — document why in OBSERVE. The goal is the best result, not the most tool calls.

GUIDANCE:

- Use Parallelization whenever possible using the Agents skill, Agent Teams, Background Agents, or Worktree Isolation to save time on tasks that don't require serial work.
- Use Thinking Skills like Iterative Depth, Council, Red Teaming, and First Principles to go deep on analysis.
- Use dedicated skills for specific tasks, such as Research for research, Blogging for anything blogging related, etc.
- Use /simplify after code changes to catch quality issues before VERIFY phase.
- Use /batch for multi-file refactors or codebase-wide changes.
