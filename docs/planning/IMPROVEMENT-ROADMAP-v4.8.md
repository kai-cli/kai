# PAI Improvement Roadmap (Post v4.7.0)

**Generated:** 2026-04-15
**Data Sources:** 49 algorithm reflections, 3 failure captures, system survey, IterativeDepth analysis
**Status:** Draft for review

---

## Priority 1 — High Impact, Clear Path

### 1.1 Memory Archival & TTL Strategy
**Signal:** LEARNING/, SIGNALS/, RELATIONSHIP/ grow unbounded. LoadContext will eventually hit context limits.
**Fix:**
- Add TTL to `SessionCleanup.hook.ts`: archive LEARNING files >90 days to `LEARNING/archive/YYYY/`
- Cap `ratings.jsonl` to last 500 entries (currently 110, growing)
- Cap `events.jsonl` to last 10,000 entries
- Add `lastArchived` timestamp to harvest state
**Effort:** ~2 hours | **Risk:** Low

### 1.2 Algorithm: Parallelization Forcing Function
**Signal:** 12 of 49 reflections mention "could have parallelized" or "should have batched". Current PLAN phase has a parallelization check but it's advisory, not enforced.
**Fix:**
- Add a mandatory gate in PLAN: if 3+ independent operations identified, parallelization plan REQUIRED before EXECUTE
- Add parallelization pattern library to Algorithm (common patterns: multi-file reads, multi-URL fetches, independent agent tasks)
- Track `parallelization_used` in reflections JSONL
**Effort:** ~1 hour | **Risk:** Low

### 1.3 Algorithm: Pre-flight Target File Reading Enforcement
**Signal:** Reflection #43 — "reading target files first revealed 4 of 6 implementations already done." Reflection #9 — "should measure key quantities in OBSERVE." Currently documented as "#1 failure pattern" but not enforced.
**Fix:**
- Make target file reading a gate (QG8): if task modifies specific files, OBSERVE cannot exit until those files are read and metrics noted
- Add file-read evidence to PRD Context section
**Effort:** ~30 min | **Risk:** Low

---

## Priority 2 — Important, Moderate Effort

### 2.1 Security: WebFetch/WebSearch Pre-Guard
**Signal:** NEXT-STEPS lists as P1 for v4.7.0, still incomplete. No outbound URL validation.
**Fix:**
- Add URL allowlist/blocklist to SecurityValidator for WebFetch/WebSearch
- Block internal network ranges (10.x, 192.168.x) from WebFetch
- Log all outbound fetches to security-events.jsonl
**Effort:** ~2 hours | **Risk:** Medium (false positives possible)

### 2.2 Security: PostToolUse Error Detection
**Signal:** PreToolUse validates, but PostToolUse has no error detection. API keys or secrets could leak in tool output.
**Fix:**
- Add PostToolUse hook that scans tool output for secret patterns (API keys, tokens, passwords)
- Alert (don't block) when potential secret detected in output
- Piggyback on existing SecretScanner patterns
**Effort:** ~2 hours | **Risk:** Low

### 2.3 Hook Timeout Hardening
**Signal:** Multiple timeout failures in FAILURES/ directory. KnowledgeSync itself needed timeout increases during development.
**Fix:**
- Verify `run-hook.sh` enforces 30s default timeout for sync hooks
- Add per-hook timeout overrides in settings.json (some hooks legitimately need >30s)
- Add timeout telemetry to events.jsonl (track which hooks are slow)
**Effort:** ~1 hour | **Risk:** Low

### 2.4 Algorithm: Version String Centralization
**Signal:** Reflection #29 — "20+ file edits for a version bump is fragile."
**Fix:**
- Single `VERSION` file or frontmatter field in Algorithm
- All references read from one source
- Deploy script handles propagation
**Effort:** ~1 hour | **Risk:** Low

---

## Priority 3 — Valuable, Needs Design

### 3.1 Algorithm: Phantom Capability Elimination
**Signal:** 4 reflections cite "selected capability but didn't invoke." Current VERIFY audit catches this after the fact but doesn't prevent it.
**Fix options:**
- A) Stricter: capabilities selected in OBSERVE create a "debt" that MUST be resolved in BUILD/EXECUTE (invoke or explicitly drop with reason)
- B) Softer: PLAN phase reviews selected capabilities and prunes any that won't actually help
- Recommendation: Option B — prune in PLAN, keep VERIFY audit as safety net
**Effort:** ~1 hour | **Risk:** Low

### 3.2 Algorithm: Context Compaction Recovery Improvement
**Signal:** Reflection #48 — "compaction mid-execute meant prior work had to be reconstructed." Current recovery reads PRD + state files but loses tool output context.
**Fix:**
- PreCompact hook already exists — enhance it to write a structured compaction summary to PRD `## Compaction` section
- Include: passing/failing criteria, key file paths modified, last tool output summary
- Recovery then reads PRD (already happening) but gets richer data
**Effort:** ~2 hours | **Risk:** Medium (compaction timing is tricky)

### 3.3 Test Coverage Expansion
**Signal:** Only 7 test files for 23 hooks + 47 skills + 14 agents. Security-critical hooks untested.
**Fix:**
- Priority test targets: SecurityValidator, RatingCapture, KnowledgeSync, LoadContext
- Test pattern: mock fs + stdin, verify stdout/stderr output and file writes
- Target: 15 test files covering all SessionStart/SessionEnd hooks
**Effort:** ~6 hours | **Risk:** Low

### 3.4 Knowledge Domain Auto-Discovery
**Signal:** Current 7 domains are hardcoded in DOMAIN_KEYWORDS. New projects or topics require manual domain addition.
**Fix:**
- Cluster memory files by keyword co-occurrence to discover natural domains
- Suggest new domains when unclustered files exceed threshold
- Low priority — 7 domains cover current work well
**Effort:** ~4 hours | **Risk:** Medium (clustering quality uncertain)

---

## Priority 4 — Nice to Have

### 4.1 Research Tool Reliability
**Signal:** Reflection #42 — "70% 403 errors" from WebFetch. Multiple reflections note URL accessibility issues.
**Fix:** Pre-test URL accessibility before building research plans. Fall back to `gh api` or direct CLI tools for known sources.
**Effort:** ~2 hours

### 4.2 ISC Quality Gate Hook
**Signal:** Gates QG1-QG7 are mandatory but only self-enforced. No hook verification.
**Fix:** PostToolUse hook that checks PRD criteria format on Write/Edit of PRD.md. Warn (don't block) on violations.
**Effort:** ~3 hours

### 4.3 Learning Pattern Synthesis Automation
**Signal:** LearningPatternSynthesis.ts exists but runs manually. No auto-trigger.
**Fix:** Add to KnowledgeSync — if >20 new ratings since last synthesis, trigger weekly synthesis.
**Effort:** ~2 hours

---

## Deferred / Won't Do

| Item | Reason |
|------|--------|
| Banner tool consolidation | Low impact, cosmetic |
| Spinner verbs/tips cleanup | 426 lines, not user-facing |
| Settings.json state split | Design improvement, no user pain |
| Pipeline monitor UI move | 15 files, non-critical |

---

## Suggested Release Plan

| Release | Items | Theme |
|---------|-------|-------|
| **v4.7.1** | 1.1, 1.2, 1.3 | Memory hygiene + Algorithm enforcement |
| **v4.8.0** | 2.1, 2.2, 2.3, 2.4 | Security hardening + stability |
| **v4.8.1** | 3.1, 3.2, 3.3 | Algorithm refinement + test coverage |
| **v4.9.0** | 3.4, 4.1, 4.2, 4.3 | Automation + intelligence |
