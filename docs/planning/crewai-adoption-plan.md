# CrewAI Pattern Adoption Plan

**Source:** CrewAI OSS (github.com/crewaiinc/crewai) analysis, 2026-05-27
**Scope:** Patterns worth stealing, mapped to PAI roadmap releases
**Principle:** Integrate into existing plan — don't create new releases for borrowed patterns

---

## Pattern → Release Mapping

| Pattern | Value | Fits In | Why Here |
|---------|-------|---------|----------|
| Composite Memory Scoring | High | **v6.5.0** | Learning Lifecycle already reworking how learnings are scored and surfaced |
| Event-Driven Checkpointing | High | **v6.6.0** | DevTeam already logs events; checkpoints enable resume-from-failure |
| Conditional Task Execution | High | **v6.6.0** | DevTeam already getting adaptive retry; conditions generalize this |
| DAG Execution Planner | Medium | **v6.6.0** | Replaces explicit phase ordering with dependency declaration |
| Tool Credential Declaration | Medium | **v6.4.1** | Security audit already auditing tool safety; credential validation fits |
| Planning Observer (Replanning) | Medium | **v7.0** | Meta-cognitive monitor already planned; this extends it mid-execution |
| A2A Delegation Protocol | Low | **v7.1+** | Useful if DevTeam grows multi-process; not needed yet |

---

## v6.4.1 Addition: Tool Credential Declaration

**What:** Tools/scripts declare their environment dependencies explicitly. Validated at load time, not at runtime failure.

**Why:** During the security audit phase, we're already auditing `Bun.spawn` calls. Adding credential validation catches a class of "tool broke because missing API key" errors before execution.

### Implementation

1. Add `credentials.yaml` to `scripts/` and skill directories:
   ```yaml
   # scripts/deliberate.ts
   credentials:
     - name: AWS_ACCESS_KEY_ID
       required: true
       description: Bedrock access
       check: "aws sts get-caller-identity"
     - name: GITHUB_TOKEN
       required: false
       description: GitHub API (falls back to gh CLI auth)
   ```

2. Add `hooks/lib/credential-validator.ts`:
   ```typescript
   interface CredentialSpec {
     name: string;
     required: boolean;
     description: string;
     check?: string; // Optional command to verify credential works
   }

   function validateCredentials(specs: CredentialSpec[]): { valid: boolean; missing: string[] } {
     const missing = specs
       .filter(s => s.required && !process.env[s.name])
       .map(s => `${s.name} (${s.description})`);
     return { valid: missing.length === 0, missing };
   }
   ```

3. DevTeam `executePhase()` validates credentials before spawning:
   - Load credential spec from preset or script directory
   - Fail fast with clear message ("Missing AWS_ACCESS_KEY_ID for Bedrock review")
   - Skip optional capabilities gracefully (e.g., Bedrock → adversarial fallback)

**Validation:**
- Missing required credential → clear error before any agent spawns
- Missing optional credential → graceful skip with log entry
- Existing `detectReviewCapability()` becomes a special case of this pattern

**Effort:** Small (1-2 hours). Additive, no refactoring.

---

## v6.5.0 Additions: Composite Memory Scoring

**What:** Replace simple recency-based learning readback with weighted composite scoring: recency (0.3) + semantic relevance (0.5) + importance (0.2).

**Why:** Current `learning-readback.ts` reads the N most recent files. A learning from 3 months ago that's highly relevant to today's task gets buried under trivial recent signals. CrewAI scores at write time AND recall time.

### Implementation

1. **Score at write time** — Add `importance` field to learning frontmatter:
   ```yaml
   ---
   type: ALGORITHM
   date: 2026-05-27
   rating: 8
   importance: 0.85  # NEW: LLM-rated at capture time (0.0-1.0)
   tags: [security, risk-classifier]
   content_hash: abc123  # For dedup
   ---
   ```
   
   Importance rating added by InsightExtractor/WorkCompletionLearning hooks during SessionEnd. Uses the existing Sonnet call (no extra inference cost — just an additional field in the prompt).

2. **Score at recall time** — New `hooks/lib/learning-scorer.ts`:
   ```typescript
   interface ScoredLearning {
     path: string;
     content: string;
     score: number; // Composite: recency + relevance + importance
   }

   interface ScoringWeights {
     recency: number;    // 0.3 — exponential decay (half-life: 14 days)
     relevance: number;  // 0.5 — keyword/tag match against session context
     importance: number; // 0.2 — from frontmatter
   }

   function scoreLearnings(
     learnings: LearningEntry[],
     sessionContext: string, // First user message + project context
     weights: ScoringWeights,
   ): ScoredLearning[] {
     return learnings
       .map(l => ({
         path: l.path,
         content: l.content,
         score: computeComposite(l, sessionContext, weights),
       }))
       .sort((a, b) => b.score - a.score);
   }

   function computeComposite(entry: LearningEntry, context: string, w: ScoringWeights): number {
     const recency = exponentialDecay(entry.date, 14); // half-life 14 days
     const relevance = tagOverlap(entry.tags, extractKeywords(context));
     const importance = entry.importance ?? 0.5; // default if not rated
     return w.recency * recency + w.relevance * relevance + w.importance * importance;
   }
   ```

3. **Update `learning-readback.ts`** — Replace `getRecentLearnings()` (pure recency) with scored retrieval:
   - LoadContext passes session context (first message or project identifier)
   - Scorer returns top-N by composite score within token budget
   - Same output format, better selection

4. **Consolidation threshold** (from CrewAI): When two learnings score > 0.85 similarity on content hash + tags, merge into one with combined frequency count. Prevents readback bloat from repeated similar lessons.

### Prerequisites (from existing v6.5.0 plan)
- Measure current readback token usage (already planned)
- Content-hash dedup (already planned)
- Event-source format (already planned)

### What NOT to do (CrewAI overkill)
- No embeddings — keyword/tag matching is sufficient at our scale (<500 learnings)
- No LLM-assisted recall — too expensive for SessionStart hot path
- No separate storage backend — files are fine, they're fast enough

**Validation:**
- A high-importance learning from 30 days ago about security outscores a trivial learning from yesterday when session context mentions "security"
- Consolidation merges near-duplicate learnings (verify dedup count drops)
- LoadContext latency stays under 100ms (existing budget)

**Effort:** Medium (one session). Builds on existing learning lifecycle work.

---

## v6.6.0 Additions: Event Checkpointing + Conditional Execution + DAG Planner

These three patterns transform DevTeam from a rigid sequential pipeline into a resumable, adaptive orchestrator.

### 6.6.0-A: Event-Driven Checkpointing (Resume from Failure)

**What:** Persist phase state at typed checkpoints so a crashed/killed DevTeam run can resume from the last completed phase instead of starting over.

**Why:** Current behavior: if `dev-team.ts` dies mid-QA, you lose the PM scoping and Dev implementation work. Must restart from scratch. With 5-minute phases, that's potentially 10+ minutes of wasted compute.

**Implementation:**

1. Define checkpoint event types in `scripts/lib/devteam-events.ts`:
   ```typescript
   type CheckpointEvent =
     | { type: "phase_started"; phase: string; agent: string; ts: string }
     | { type: "phase_completed"; phase: string; agent: string; output_path: string; duration_ms: number }
     | { type: "phase_failed"; phase: string; agent: string; error: string; attempt: number }
     | { type: "verdict"; phase: string; result: "pass" | "fail"; priority?: string }
     | { type: "run_started"; config: TeamConfig }
     | { type: "run_completed"; total_ms: number; verdict: string };
   ```

2. Persist phase outputs to disk (not just logs):
   ```
   ~/.claude/teams/{team-name}/
     run.jsonl           ← existing event log
     checkpoints/        ← NEW
       scope.output.md   ← PM findings (written after phase_completed)
       implement.output.md
       verify.output.md
       config.json       ← serialized TeamConfig for resume
   ```

3. Add `--resume <team-name>` flag to `dev-team.ts`:
   ```typescript
   async function resumeRun(teamName: string): Promise<string> {
     const checkpointDir = join(TEAMS_DIR, teamName, "checkpoints");
     const config = JSON.parse(readFileSync(join(checkpointDir, "config.json"), "utf-8"));
     
     // Find last completed phase
     const phases = ["scope", "implement", "verify", "review", "report"];
     let resumeFrom = 0;
     for (const phase of phases) {
       if (existsSync(join(checkpointDir, `${phase}.output.md`))) {
         resumeFrom = phases.indexOf(phase) + 1;
       }
     }
     
     console.log(`Resuming from phase: ${phases[resumeFrom]} (${resumeFrom}/${phases.length})`);
     return orchestrate(config, { resumeFrom, checkpointDir });
   }
   ```

4. Modify `orchestrate()` to accept resume state:
   - Skip completed phases, load their outputs from checkpoint files
   - Continue from first incomplete phase with full context

**Validation:**
- Kill dev-team mid-implement → `--resume` picks up from implement (doesn't re-run PM)
- Kill dev-team mid-QA → `--resume` picks up from QA with Dev output loaded
- Normal runs write checkpoints without any user-visible behavior change
- Checkpoint files are cleaned up after successful `run_completed`

---

### 6.6.0-B: Conditional Task Execution

**What:** Phases can declare conditions that evaluate prior phase output. If the condition is false, the phase is skipped.

**Why:** Currently DevTeam always runs PM→Dev→QA→Review in sequence. But:
- Investigation presets don't need QA verification
- Simple typo fixes don't need PM scoping (issue IS the spec)
- Review should be skipped if the diff is under N lines (low risk)

CrewAI's `ConditionalTask` pattern makes this declarative in the preset.

**Implementation:**

1. Add `condition` field to preset phases:
   ```yaml
   # Presets/bug-fix.yaml (updated)
   name: Bug Fix
   retry_max: 2
   phases:
     - id: scope
       role: pm
       agent_type: Plan
       model: sonnet
       worktree: false
       
     - id: implement
       role: dev
       agent_type: Engineer
       model: sonnet
       worktree: true
       
     - id: verify
       role: qa
       agent_type: QATester
       model: sonnet
       worktree: false
       condition: "output.implement.length > 500"  # Skip QA for trivial changes
       
     - id: review
       role: reviewer
       agent_type: TechnicalReviewer
       model: sonnet
       worktree: false
       condition: "diff_lines > 50"  # Only review substantial changes
   ```

2. Condition evaluator in `scripts/lib/devteam-conditions.ts`:
   ```typescript
   interface PhaseContext {
     output: Record<string, string>;  // Prior phase outputs
     diff_lines: number;              // Git diff line count
     attempt: number;                 // Current retry attempt
     issue_length: number;            // Original issue text length
     has_tests: boolean;              // Whether test files were modified
   }

   function evaluateCondition(condition: string, ctx: PhaseContext): boolean {
     // Simple expression evaluator (no eval — safe predicate matching)
     // Supports: output.X.length, diff_lines, attempt, has_tests, comparisons
     return parseCondition(condition).evaluate(ctx);
   }
   ```

3. Update `orchestrate()` loop:
   ```typescript
   for (const phase of config.preset.phases) {
     if (phase.condition) {
       const ctx = buildPhaseContext(completedPhases, config);
       if (!evaluateCondition(phase.condition, ctx)) {
         log(config.teamName, phase.id, "skipped", { condition: phase.condition });
         console.log(`  [${phase.id}] Skipped (condition: ${phase.condition})`);
         continue;
       }
     }
     // ... execute phase as normal
   }
   ```

**Validation:**
- Trivial 3-line fix (< 500 chars Dev output) → QA skipped, logged as "skipped"
- 200-line refactor → QA and Review both execute
- `--strict` flag ignores all conditions and runs everything (escape hatch)
- Conditions appear in run.jsonl for observability

---

### 6.6.0-C: DAG Execution Planner

**What:** Instead of hardcoded phase ordering (scope→implement→verify→review), phases declare their dependencies and the orchestrator builds an execution plan.

**Why:** Enables parallel phase execution when dependencies allow it. Example: security review and QA verification can run simultaneously (both depend on implement, neither depends on each other).

**Implementation:**

1. Replace sequential `phases` list with dependency-declared phases:
   ```yaml
   # Presets/feature.yaml (evolved)
   name: Feature Build
   retry_max: 2
   phases:
     - id: scope
       role: pm
       depends_on: []  # Root node — runs first
       
     - id: implement
       role: dev
       depends_on: [scope]
       
     - id: verify
       role: qa
       depends_on: [implement]
       condition: "output.implement.length > 500"
       
     - id: security-review
       role: security
       depends_on: [implement]
       condition: "has_security_keywords"
       
     - id: review
       role: reviewer
       depends_on: [implement]
       condition: "diff_lines > 50"
   ```

2. `scripts/lib/devteam-dag.ts`:
   ```typescript
   interface PhaseNode {
     id: string;
     depends_on: string[];
     condition?: string;
   }

   function buildExecutionPlan(phases: PhaseNode[]): string[][] {
     // Topological sort into execution tiers
     // Phases in the same tier can run in parallel
     const tiers: string[][] = [];
     const completed = new Set<string>();
     const remaining = [...phases];

     while (remaining.length > 0) {
       const tier = remaining.filter(p =>
         p.depends_on.every(dep => completed.has(dep))
       );
       if (tier.length === 0) throw new Error("Circular dependency in phase graph");
       tiers.push(tier.map(p => p.id));
       tier.forEach(p => {
         completed.add(p.id);
         remaining.splice(remaining.indexOf(p), 1);
       });
     }
     return tiers;
   }
   ```

3. Update orchestrator to execute tiers:
   ```typescript
   const plan = buildExecutionPlan(config.preset.phases);
   // plan = [["scope"], ["implement"], ["verify", "security-review", "review"]]
   
   for (const tier of plan) {
     const results = await Promise.all(
       tier
         .filter(phaseId => !shouldSkip(phaseId, context))
         .map(phaseId => executePhaseWithRecovery(...))
     );
     // Merge results into context for next tier
   }
   ```

**Compatibility:** Existing presets without `depends_on` default to sequential execution (each phase depends on the previous). Zero breaking changes.

**Validation:**
- Feature preset with QA + security-review in same tier → both run in parallel
- Circular dependency → clear error at plan-build time, not at runtime
- Dry-run shows execution plan: "Tier 1: scope | Tier 2: implement | Tier 3: verify, security-review, review"
- Existing bug-fix preset works unchanged (sequential by default)

---

### 6.6.0-D: Blocked Agent Detection (already planned — enhanced with CrewAI output monitoring)

The existing plan has stall detection (60s silence → warning, 120s → blocked → recovery). CrewAI adds a pattern worth stealing: **output content analysis**, not just byte count.

**Enhancement:** After 60s of output silence, read the last 500 bytes of stdout. If they contain patterns like:
- Repeated "Let me think about this..." 
- Self-referential loops ("As I mentioned earlier...")
- Question-asking without tool use ("Should I proceed with...") 

Then classify as "deliberation loop" and inject a focus prompt immediately (don't wait for 120s).

```typescript
function classifyStallContent(lastOutput: string): "productive-pause" | "deliberation-loop" | "unknown" {
  const loopPatterns = [
    /let me (think|reconsider|reflect)/i,
    /as (I|we) (mentioned|discussed) (earlier|above|previously)/i,
    /should (I|we) (proceed|continue|try)/i,
    /to summarize what (I've|we've) done/i,
  ];
  const matches = loopPatterns.filter(p => p.test(lastOutput));
  return matches.length >= 2 ? "deliberation-loop" : "unknown";
}
```

---

## v7.0 Addition: Planning Observer (Adaptive Replanning)

**What:** The meta-cognitive monitor (already planned) gains the ability to observe step-by-step execution and trigger replanning when outcomes diverge from the original plan.

**Why:** Current Algorithm runs a plan to completion. If step 3 of 5 reveals the plan was based on wrong assumptions, steps 4-5 execute anyway (wasting context). CrewAI's `PlannerObserver` monitors each step and can rewrite remaining steps.

### Integration with Meta-Cognitive Monitor

The v7.0 plan already extracts Algorithm into a post-generation policy linter. The Planning Observer extends this from "check at the end" to "check between steps":

```typescript
interface StepOutcome {
  step: number;
  expected: string;   // From the plan
  actual: string;     // What the step produced
  divergence: number; // 0.0 (as expected) to 1.0 (completely different)
}

interface ReplanDecision {
  shouldReplan: boolean;
  reason?: string;
  newSteps?: string[];  // Replacement for remaining steps
}

function evaluateStepDivergence(outcome: StepOutcome): ReplanDecision {
  if (outcome.divergence < 0.3) return { shouldReplan: false };
  
  // High divergence: the plan's assumptions were wrong
  return {
    shouldReplan: true,
    reason: `Step ${outcome.step} diverged significantly from plan. Expected: "${outcome.expected.slice(0, 50)}..." Got: "${outcome.actual.slice(0, 50)}..."`,
    // newSteps generated by the monitor's next inference call
  };
}
```

**Scope limitation:** Only applies to Algorithm-mode responses (multi-step OODA-V cycles). NATIVE mode responses don't have steps to observe.

**Prerequisite:** Algorithm decomposition (v6.5.1) must complete first — can't observe individual phases until they're extracted into separate functions.

---

## What We're NOT Adopting (and Why)

| CrewAI Pattern | Why Skip |
|----------------|----------|
| Pydantic-first models | Our TypeScript types + Zod validation already cover this |
| Flow system (@start, @listen, @router) | Algorithm already fills this role; adding another execution model creates confusion |
| Hierarchical process with manager | DevTeam PM role already does this; CrewAI's manager is less opinionated |
| Knowledge/RAG sources | Our skill + wiki + memory system already covers multi-source knowledge |
| LiteAgent (lightweight execution) | Claude Code subagents already have this distinction (full Agent vs inline Bash) |
| Embeddings for memory recall | Overkill at <500 learnings; keyword matching is fast and sufficient |
| Full event bus with handler graph | Our hook system is already event-driven; adding a separate bus creates two systems |
| Skills progressive disclosure | Our SKILL.md → Workflow → Context loading already does 3-tier disclosure |

---

## Implementation Order

```
v6.4.1 (next session):
  + Tool Credential Declaration (small, fits security audit)

v6.5.0 (learning lifecycle session):
  + Composite Memory Scoring (medium, builds on existing readback rework)
  + Importance rating at write time (small, adds field to existing prompt)
  + Consolidation threshold (small, dedup enhancement)

v6.6.0 (DevTeam intelligence session — 2-3 sessions):
  + Event-Driven Checkpointing (medium — resume from failure)
  + Conditional Task Execution (medium — declarative skip logic)
  + DAG Execution Planner (medium — parallel tiers)
  + Blocked Agent Detection enhancement (small — content analysis)
  [existing items remain: cost tracking, dynamic roles, adaptive retry]

v7.0 (meta-cognitive monitor):
  + Planning Observer / Adaptive Replanning (medium — step-by-step checking)
  [existing items remain: policy extraction, output formatting spec]
```

---

## Decision Log Entry

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-27 | Adopt 7 CrewAI patterns across 4 releases | Patterns fit existing plan themes; no new releases needed. Highest value: checkpoint/resume, composite scoring, conditional execution |
| 2026-05-27 | Skip embeddings, event bus, Flow system | Already have equivalents (tag matching, hooks, Algorithm). Adding parallel systems creates confusion |
| 2026-05-27 | DAG planner over explicit ordering | Enables parallel phases without breaking existing presets (sequential = default) |
| 2026-05-27 | Content-based stall detection over pure silence | CrewAI's output monitoring identifies deliberation loops faster than byte counting alone |
