# Plan: Research Mode for Deliberate + Cross-Validation Workflow

## Context

A coworker submitted a standalone `research.ts` script implementing multi-model research via a Scatter-Verify-Synthesize pipeline with rotation-based empirical validation. Review identified strong concepts (confidence stratification, rotation mode, no-echo-chamber principle) but critical flaws: no web search (cross-validated hallucination), would destroy 13 existing Research workflows, no Research Index integration, sequential rotation execution.

This plan integrates the good parts into the existing Deliberate skill as a new `--mode research`, adds web search grounding to make it actual research, and exposes it through both the Deliberate and Research skills.

**Decisions (confirmed by YourName):**
- GPT-4o: Use OpenAI Responses API (`/v1/responses`) for web search
- Extract shared model invocation to `PAI/Tools/ModelInvocation.ts`
- Rotation mode: warn-and-proceed (no blocking confirmation)
- Model selection: dynamic — tool selects optimal models per role from available pool, user can override via `--roles`. Must be extensible as new models are added.

---

## Files to Modify

| File | Action |
|---|---|
| `PAI/Tools/ModelInvocation.ts` | **New** — shared model invocation with web search support |
| `PAI/Tools/Inference.ts` | **Modify** — add `tools` param to enable web_search for Claude |
| `scripts/deliberate.ts` | **Modify** — refactor to use ModelInvocation, add `--mode research`, `--rotate`, `--search`, `--roles`, `--no-search` |
| `skills/Deliberate/SKILL.md` | **Modify** — add Research workflow to routing table |
| `skills/Deliberate/Workflows/Research.md` | **New** — workflow doc for research mode |
| `skills/Deliberate/ModelPanel.md` | **Modify** — add research role descriptions + dynamic selection docs |
| `skills/Deliberate/OutputFormat.md` | **Modify** — add research report format |
| `skills/Research/SKILL.md` | **Modify** — add cross-validation to routing table |
| `skills/Research/Workflows/CrossValidation.md` | **New** — workflow routing to `deliberate.ts --mode research` |

---

## Step 1: `PAI/Tools/Inference.ts` — Add `tools` Parameter

**File:** `/Users/user/Projects/pai-config/PAI/Tools/Inference.ts`

Add optional `tools` field to `InferenceOptions`:

```typescript
export interface InferenceOptions {
  systemPrompt: string;
  userPrompt: string;
  level?: InferenceLevel;
  expectJson?: boolean;
  timeout?: number;
  tools?: string;  // e.g. 'web_search' — passed to --tools flag
}
```

In the `inference()` function, change the args construction:

```typescript
const args = [
  '--print',
  '--model', config.model,
  '--tools', options.tools ?? '',  // Empty string disables tools (current behavior)
  '--output-format', 'text',
  '--setting-sources', '',
  '--system-prompt', options.systemPrompt,
];
```

This is backward-compatible — existing callers don't pass `tools`, so they get `''` (disabled).

---

## Step 2: `PAI/Tools/ModelInvocation.ts` — Shared Model Invocation

**File:** `/Users/user/Projects/pai-config/PAI/Tools/ModelInvocation.ts` (new)

Extract and extend the model invocation layer from `deliberate.ts`. This module:

1. **Exports types:** `ModelConfig`, `InvocationResult`, `InvocationOptions`
2. **Exports `invokeModel()`** — dispatches to correct provider with optional web search
3. **Provider implementations:**
   - `invokeClaudeModel()` — uses PAI Inference with optional `tools: 'web_search'`
   - `invokeGemini()` — adds `tools: [{ googleSearch: {} }]` when search enabled
   - `invokeGrok()` — adds `search_mode` parameter when search enabled (xAI API)
   - `invokeOpenAIChat()` — existing chat/completions (no search)
   - `invokeOpenAIResponses()` — NEW: uses `/v1/responses` with `web_search_preview` tool
   - `invokeOpenAICompatible()` — for DeepSeek, Mistral, future providers
4. **Exports `DEFAULT_MODELS`** — full model registry with capabilities metadata
5. **Exports `getAvailableModels()`** — filters to models with valid API keys

**Model registry includes capability metadata for dynamic role assignment:**

```typescript
interface ModelConfig {
  id: string;
  name: string;
  provider: "claude" | "gemini" | "openai-responses" | "openai-compatible";
  model: string;
  persona: string;           // for debate mode
  systemPrompt: string;      // for debate mode
  envKey?: string;
  baseUrl?: string;
  capabilities: {
    webSearch: boolean;       // can this model search the web?
    reasoning: "high" | "medium";
    contextWindow: number;    // for scholar role (large context preferred)
  };
  roleAffinity: {            // scored 1-5, used for auto-assignment
    explorer: number;
    scholar: number;
    factChecker: number;
    synthesizer: number;
  };
}
```

**Default role affinities (initial, refinable by rotation results):**

| Model | Explorer | Scholar | Fact-Checker | Synthesizer |
|---|---|---|---|---|
| GPT-4o | 5 | 3 | 3 | 4 |
| Gemini | 4 | 5 | 3 | 3 |
| Grok | 3 | 2 | 5 | 2 |
| Claude | 3 | 4 | 4 | 5 |
| DeepSeek | 2 | 3 | 4 | 3 |
| Mistral | 3 | 3 | 3 | 4 |

**Dynamic role assignment algorithm:**

```
1. Get available models (those with valid API keys)
2. For each role (Explorer, Scholar, Fact-Checker, Synthesizer):
   - Score = roleAffinity[role]
   - If role needs webSearch and model lacks it: score -= 3
   - Select highest unassigned model
3. User overrides applied last (--roles explorer=gemini,...)
```

This means as new models are added to the registry, they participate automatically based on their affinity scores. Rotation mode empirically validates/updates these scores.

---

## Step 3: `scripts/deliberate.ts` — Add Research Mode

**File:** `/Users/user/Projects/pai-config/scripts/deliberate.ts`

### Refactor existing code

- Remove inline model invocation functions (now in ModelInvocation.ts)
- Import `invokeModel`, `DEFAULT_MODELS`, `getAvailableModels`, `ModelConfig` from ModelInvocation
- Keep debate orchestration (`deliberate()` function) and prompt builders
- Keep CLI, formatting, report generation

### Add new CLI flags

```typescript
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    // Existing
    rounds: { type: "string", default: "2" },
    models: { type: "string", default: "" },
    output: { type: "string", default: "" },
    config: { type: "string", default: "" },
    verbose: { type: "boolean", default: false },
    "list-models": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
    // New
    mode: { type: "string", default: "debate" },     // "debate" | "research"
    rotate: { type: "boolean", default: false },       // rotation mode
    search: { type: "boolean" },                       // enable web search (default: on for research, off for debate)
    "no-search": { type: "boolean", default: false },  // force disable web search
    roles: { type: "string", default: "" },            // role overrides: "explorer=gemini,scholar=claude"
  },
  allowPositionals: true,
});
```

### Research pipeline: Scatter-Verify-Synthesize

New function `researchStandard()`:

```
Phase 1 (Scatter) — PARALLEL
  ├── Explorer: broad research, map landscape    [web search ON]
  └── Scholar: academic/authoritative sources     [web search ON]

Phase 2 (Verify) — SEQUENTIAL (needs Phase 1)
  └── Fact-Checker: validate, find contradictions [web search ON]

Phase 3 (Synthesize) — SEQUENTIAL (needs Phase 2)
  └── Synthesizer: confidence-stratified report   [web search OFF]
```

**Role system prompts** (research-specific, distinct from debate personas):

- **Explorer:** "Conduct broad research. Find diverse sources. Map the information landscape. Include URLs."
- **Scholar:** "Find authoritative and academic sources. Cite specific studies. Assess academic consensus."
- **Fact-Checker:** "Verify findings from Explorer and Scholar. Check contradictions, credibility, unsubstantiated claims."
- **Synthesizer:** "Integrate all findings into HIGH/MEDIUM/LOW confidence report with knowledge gaps."

**Error resilience:**
- Phase 1: If one agent fails, proceed with the other (note degradation in output)
- Phase 2: If Fact-Checker fails, Synthesizer works with Phase 1 only (lower confidence)
- Phase 3: If Synthesizer fails, fall back to Claude Sonnet

### Rotation pipeline

New function `researchRotation()`:

```
For N available models assigned to 4 roles:
  Generate all unique role permutations (or limit to 4 rotations for performance)
  Run ALL rotations in PARALLEL via Promise.all()
  Each rotation runs standard Scatter-Verify-Synthesize internally
  
After all rotations complete:
  Meta-analysis by Claude: consistent findings, contradictions, model performance per role
```

**Parallel execution is the key improvement over the coworker's sequential approach.**

Wall-clock time: ~same as 1 rotation (~60-90s) instead of N * 60-90s.

**Cost warning (non-blocking):**
```
⚠️ Rotation mode: ~16 API calls, estimated $0.60-0.80
Running 4 rotations in parallel...
```

### Output format for research mode

```markdown
# Research Report: [Question]

**Date:** ...  |  **Mode:** standard/rotation  |  **Duration:** Xs
**Models:** Explorer(GPT-4o), Scholar(Gemini), Fact-Checker(Grok), Synthesizer(Claude)

## HIGH-CONFIDENCE FINDINGS
[Cross-verified claims with strong sources]

## MEDIUM-CONFIDENCE FINDINGS
[Supported but with caveats]

## LOW-CONFIDENCE FINDINGS
[Weak sources or contradicted]

## KNOWLEDGE GAPS
[What's missing or unknown]

## SOURCE SUMMARY
[Quality assessment, key URLs]

## METHODOLOGY
[Which models filled which roles, search enabled, error notes]
```

Rotation mode adds:
```markdown
## ROTATION ANALYSIS
### Consistent Findings (3+ rotations)
### Contradictions
### Model Performance by Role
### Recommended Optimal Assignments
```

---

## Step 4: Skill Documentation Updates

### `skills/Deliberate/SKILL.md`

Add to workflow routing table:

| Trigger | Workflow |
|---|---|
| "research deliberation" / "deliberate with research" / "grounded research" | `Workflows/Research.md` |

Update Quick Reference table with Research row.

### `skills/Deliberate/Workflows/Research.md` (new)

Workflow doc that:
1. Determines research question
2. Runs `bun ~/.claude/scripts/deliberate.ts --mode research --verbose "<question>"`
3. For high-stakes: adds `--rotate`
4. For saved report: adds `--output <path>`
5. Presents using research output format from `OutputFormat.md`

### `skills/Deliberate/ModelPanel.md`

Add section on research roles:
- Explorer, Scholar, Fact-Checker, Synthesizer descriptions
- Default affinity scores
- How dynamic assignment works
- How to override with `--roles`

### `skills/Deliberate/OutputFormat.md`

Add research report format template (standard + rotation).

### `skills/Research/SKILL.md`

Add to workflow routing under "Specific Research Types":

| Trigger | Workflow |
|---|---|
| "cross-validate" / "multi-model research" / "verify across models" | `Workflows/CrossValidation.md` |

### `skills/Research/Workflows/CrossValidation.md` (new)

Workflow that:
1. Runs `bun ResearchIndex.ts dedup "<topic>"` to check for prior research
2. If prior exists, seeds prompts with summary
3. Runs `bun deliberate.ts --mode research --verbose "<question>"`
4. Runs `bun ResearchIndex.ts save ...` to persist findings
5. Applies URL Verification Protocol to output
6. Presents to user

This keeps Research Index integration and URL verification at the workflow level, matching the existing Research skill pattern.

---

## Step 5: Testing & Verification

### Unit verification
```bash
# 1. Check Inference.ts tools param works
bun PAI/Tools/Inference.ts --level fast "You are helpful" "Search for: what is today's date?"
# Expect: no search (tools not passed)

# 2. Check ModelInvocation exports
bun -e "import { getAvailableModels } from './PAI/Tools/ModelInvocation.ts'; console.log(getAvailableModels().map(m => m.id))"

# 3. List models with capabilities
bun scripts/deliberate.ts --list-models
# Should show all models with search capability column
```

### Integration verification
```bash
# 4. Standard research (4 calls, web search enabled)
bun scripts/deliberate.ts --mode research --verbose "What browsers support WebGPU in 2026?"
# Expect: confidence-stratified report with real URLs

# 5. Research without web search (cross-validation only)
bun scripts/deliberate.ts --mode research --no-search --verbose "Is Rust faster than Go?"
# Expect: works but output notes search was disabled

# 6. Rotation mode (parallel)
bun scripts/deliberate.ts --mode research --rotate --verbose "HTTP/3 adoption status"
# Expect: ~60-90s wall clock, meta-analysis with model-per-role rankings

# 7. Custom role assignment
bun scripts/deliberate.ts --mode research --roles "explorer=claude,synthesizer=gemini" --verbose "Test question"

# 8. Debate mode unchanged (regression test)
bun scripts/deliberate.ts --rounds 2 --verbose "Monorepo vs polyrepo?"
# Expect: identical to current behavior

# 9. Debate with web search (new capability)
bun scripts/deliberate.ts --search --verbose "Should we adopt HTTP/3?"
# Expect: debate format but with web-grounded responses
```

### Error cases
```bash
# 10. Missing API key graceful degradation
GEMINI_API_KEY="" bun scripts/deliberate.ts --mode research --verbose "Test"
# Expect: reassigns roles to available models, warns about degradation

# 11. All external keys missing
GEMINI_API_KEY="" GROK_API_KEY="" OPENAI_API_KEY="" bun scripts/deliberate.ts --mode research --verbose "Test"
# Expect: runs with Claude only, warns about limited coverage
```

---

## Implementation Order

| Step | What | Depends On |
|---|---|---|
| 1 | `Inference.ts` — add `tools` parameter | — |
| 2 | `ModelInvocation.ts` — new shared module | Step 1 |
| 3 | `deliberate.ts` — refactor to use ModelInvocation (no new features yet, regression test) | Step 2 |
| 4 | `deliberate.ts` — add `--mode research` with Scatter-Verify-Synthesize | Step 3 |
| 5 | `deliberate.ts` — add `--rotate` with parallel execution | Step 4 |
| 6 | `deliberate.ts` — add `--search`/`--no-search` web search toggling | Steps 2, 4 |
| 7 | `deliberate.ts` — add `--roles` dynamic assignment + overrides | Steps 4, 5 |
| 8 | `deliberate.ts` — error resilience (graceful degradation) | Steps 4-7 |
| 9 | Skill docs — Deliberate SKILL.md, Research.md, ModelPanel.md, OutputFormat.md | Steps 4-7 |
| 10 | Skill docs — Research SKILL.md, CrossValidation.md | Step 9 |
| 11 | End-to-end testing | All |
