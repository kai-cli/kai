# Hook Integration Test Backlog

Hooks not yet covered by integration tests. Safety-critical hooks (SecurityValidator, GitHubWriteGuard, SecretScanner) are covered in `tests/`. The remaining hooks are parameter validators or cosmetic — their failure mode is wrong config, not data destruction.

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
