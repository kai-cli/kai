# Hook Integration Test Backlog

Hooks not yet covered by integration tests. Safety-critical hooks (SecurityValidator, GitHubWriteGuard, SecretScanner) are covered in `tests/`. The remaining hooks are parameter validators or cosmetic — their failure mode is wrong config, not data destruction.

## Consolidation Workstream Testing Gaps (added 2026-06-05, from W2/W13/W3)
Detail + rationale in `PAI-Wiki/findings/session-findings-2026-06-05.md` (SF-1…SF-9).
- [ ] **SF-7 — SessionEnd chain integration test.** No test exercises the full SessionEnd hook sequence end-to-end (parse → extractors → KnowledgeSync). Becomes critical with W4 (composite reorders this chain). Build a harness that feeds a fixture transcript through the composite and asserts each extractor's output. **PREREQ for trusting W4.**
- [ ] **SF-8 — transcript-cache concurrency harness.** W3 cache is written by parallel SessionEnd subprocesses; atomic tmp+rename is unit-tested but not under real concurrent load. Add a harness spawning N processes calling `getCachedTranscript` on one transcript, asserting no corruption + ≤1 parse.
- [ ] **SF-9 — runtime effectiveness telemetry.** No signal on whether W2 scorer / W3 cache actually help in practice. Add lightweight telemetry (cache hit-rate, scorer-vs-keyword injection deltas) to `hook-perf.jsonl`, reviewed after ~1 week of real use. This is the long-term feedback loop, not a unit test.
- [ ] **SF-1 — RelationshipMemory regression test.** Assert user-side entries are captured (currently broken — reads non-existent `parsed.userPrompt`). Pairs with the SF-1 bug fix.
- [ ] **SF-2 — restore full `bun test`.** Whole-suite run segfaults bun 1.3.9; bisect + quarantine/upstream so there's a single green-suite signal again.

## Parameter Validators
- [ ] SkillGuard — validates skill selection parameters
- [ ] AgentExecutionGuard — validates agent config before spawn

## Cosmetic / Analytics Hooks
- [ ] TerminalState — terminal title/tab updates
- [ ] UpdateTabTitle — tab title from session context
- [ ] SetQuestionTab — tab title during AskUserQuestion
- [ ] RatingCapture — captures user satisfaction signals
- [ ] SessionAutoName — auto-names sessions from first prompt
- [ ] PromptAnalysis — batched inference for naming/classification
- [ ] StartupGreeting — session start banner
- [ ] FormatReminder — output format compliance
- [ ] AlgorithmTracker — tracks Algorithm phase progress
- [ ] PRDSync — syncs PRD frontmatter to dashboard
- [ ] ModeClassifier — classifies request to NATIVE/ALGORITHM/MINIMAL
- [ ] CheckVersion — checks for PAI updates
- [ ] ConfigChange — detects config file modifications
- [ ] SessionCleanup — cleans old session state files
- [ ] PreCompact — preserves context before compaction
- [ ] PostCompactRecovery — restores context after compaction
- [ ] LocalContextFirst — injects project context
- [ ] LoadContext — loads startup context files
- [ ] RelationshipMemory — tracks interaction patterns
- [ ] QuestionAnswered — logs AskUserQuestion responses
- [ ] UpdateCounts — updates runtime count metrics
- [ ] WorkCompletionLearning — captures learning on task complete
- [ ] TaskCompleted — fires on task completion
- [ ] TeammateIdle — detects idle teammates
- [ ] StopOrchestrator — manages orchestrator shutdown
- [ ] SessionSummary — generates session summary
- [ ] LastResponseCache — caches last response for recovery
- [ ] IntegrityCheck — validates system file integrity
- [ ] WorktreeSetup — initializes git worktree
- [ ] WorktreeRemove — cleans up git worktree

## Post-KAI-sync tickets (added 2026-06-05)
Detail in `PAI-Wiki/findings/session-findings-2026-06-05.md` (SF-12…SF-20).
- [ ] **SF-19 — KAI CI is red (HIGH).** kai-cli/kai Actions failing ≥3 pushes: 2 failing tests on bun 1.3.14 + `bash -e` has no SF-2 panic guard. Identify the 2 tests, fix/gate them, make CI resilient to the bun panic.
- [ ] **SF-18 — verify-release.sh scans kai not KAI.** The sync's Step-6 gate is false signal; make it scan the KAI tree (pairs with SF-15 per-feature verification).
- [ ] **SF-20 — version reconciliation (HOLD until main task done).** VERSION 7.1.0 ≠ manifest 7.0.0 in both repos; memcarry 0.0.1 unversioned. Bump to **7.2** + changelog (W2/W3/W4/W13 + Memcarry public) AFTER consolidation completes. Do NOT bump mid-task.
- [ ] **Stale-ticket hygiene.** SF-7/10/11/12/13/14/16/17 are DONE — keep findings table current.
