# Algorithm Migration Guide

Guide to migrating between PAI Algorithm versions, focusing on changes from v3.12.0 through v3.14.0 (current).

## Current Version: v3.14.0

The latest stable version as of May 2026. No migration needed if you're already on v3.14.0.

**To check your version:**
```bash
cat ~/.claude/PAI/Algorithm/LATEST
```

## Version History

| Version | Release | Status | Key Changes |
|---------|---------|--------|-------------|
| v3.14.0 | March 2026 | Current | Minor refinements, same core structure as v3.13.0 |
| v3.13.0 | February 2026 | Stable | Capability selection overhaul, PRD direct-write |
| v3.12.0 | January 2026 | Archived | Earlier iteration, different ISC handling |
| v3.11.0 | December 2025 | Archived | Pre-capability-selection model |
| Earlier | 2025 | Archived | Foundational versions |

## Migration Paths

### v3.12.0 → v3.13.0 (Major Changes)

**Breaking Changes:**

1. **Capability Selection Philosophy**
   - **Old (v3.12)**: Capabilities were implicitly assumed or manually invoked
   - **New (v3.13+)**: Mandatory capability consideration in OBSERVE phase. Must document which capabilities help and why, or explicitly state none needed.
   - **Migration**: Add capability evaluation step to OBSERVE phase. Review [CapabilitySelection.md](../PAI/Algorithm/CapabilitySelection.md).

2. **PRD Direct-Write Model**
   - **Old (v3.12)**: Hooks managed some PRD updates
   - **New (v3.13+)**: AI writes ALL PRD content directly using Write/Edit tools. Hooks only READ for sync to work.json.
   - **Migration**: Remove any PRD-writing hooks. Ensure PostToolUse hook (PRDSync.hook.ts) is read-only.

3. **Capability Invocation Requirements**
   - **Old (v3.12)**: Selecting a capability was advisory
   - **New (v3.13+)**: Every selected capability MUST be invoked via real tool call (Skill tool for skills, Task tool for agents). Selecting without invoking is CRITICAL FAILURE.
   - **Migration**: Audit capability selection. Ensure every selected capability has corresponding Skill() or Task() invocation.

4. **Closed Capability List**
   - **Old (v3.12)**: Open-ended capability references
   - **New (v3.13+)**: Fixed list of capabilities in algorithm file. Cannot reference unlisted capabilities.
   - **Migration**: Check available capabilities table in v3.13.0.md. Remove references to deprecated capabilities.

**Non-Breaking Improvements:**

- Atomicity rule clarification (one tool invocation per criterion)
- Enhanced ISC decomposition methodology
- Refined time budgets per phase
- Clearer anti-criteria (ISC-A prefix) guidance

**Migration Checklist:**

- [ ] Update Algorithm LATEST pointer: `echo "v3.13.0" > ~/.claude/PAI/Algorithm/LATEST`
- [ ] Review capability selection documentation
- [ ] Audit existing PRDs for compound criteria (split if needed)
- [ ] Verify PRDSync hook is read-only (no Write/Edit of PRD.md)
- [ ] Test sample workflow to ensure capabilities invoke correctly

### v3.13.0 → v3.14.0 (Minor Refinements)

**Changes:**
- Version number bump in banner
- Minor documentation refinements
- No breaking changes
- No behavioral differences

**Migration:**
Simply update LATEST pointer:
```bash
echo "v3.14.0" > ~/.claude/PAI/Algorithm/LATEST
```

No code changes required. Existing v3.13.0 workflows are fully compatible.

## Core Concepts (Stable Across Versions)

These fundamentals have remained consistent since v3.10.0:

### Ideal State Criteria (ISC)
- Discrete, granular, binary, testable criteria
- Verifiable with YES/NO answer
- 8-12 words per criterion
- Atomic (one tool invocation to verify)

### Seven Phases
1. OBSERVE - Understanding + ISC generation (20% of budget)
2. THINK - Pressure testing + refinement (10%)
3. PLAN - Execution strategy (5%)
4. BUILD - Preparation + capability invocation (10%)
5. EXECUTE - The actual work (40%)
6. VERIFY - Testing + evidence (10%)
7. LEARN - Reflection + handoff (5%)

### Effort Levels
- Micro: <30s, 1-4 criteria (handled inline)
- Standard: <2min, 8-16 criteria (default)
- Extended: <8min, 16-32 criteria
- Advanced: <16min, 24-48 criteria
- Deep: <32min, 40-80 criteria
- Comprehensive: <120min, 64-150 criteria

### PRD Structure (Since v3.13.0)
- YAML frontmatter (task, slug, effort, phase, progress, mode, started, updated)
- Context section
- Criteria section (checkboxes: `- [ ] ISC-C1: text`)
- Decisions section
- Verification section
- Progress counter in frontmatter (`progress: 3/8`)

## Common Migration Issues

### Issue: Capabilities Selected But Not Invoked

**Symptom:** Algorithm selects capability (e.g., "Research") but doesn't actually call `Skill("Research")`.

**Root Cause:** v3.12.0 allowed advisory capability selection. v3.13.0+ requires actual invocation.

**Fix:**
```diff
- Will use Research skill for technical investigation
+ Using Research skill for technical investigation
+ [Skill tool call: Skill("Research")]
```

### Issue: Compound ISC Criteria

**Symptom:** Criteria like "Tests pass and coverage exceeds 80%"

**Root Cause:** Pre-v3.13.0 allowed multi-part criteria.

**Fix:**
```diff
- ISC-C4: Tests pass and coverage exceeds 80%
+ ISC-C4: bun test exits 0 with all tests passing
+ ISC-C5: Coverage report shows ≥80% line coverage
```

### Issue: Hook Writing to PRD

**Symptom:** PostToolUse hook modifies PRD.md

**Root Cause:** v3.12.0 design allowed hook PRD manipulation.

**Fix:** Update hook to read-only. AI must write all PRD content directly.

## Rollback Procedure

If v3.14.0 causes issues, rollback to v3.13.0:

```bash
# 1. Update LATEST pointer
echo "v3.13.0" > ~/.claude/PAI/Algorithm/LATEST

# 2. Restart Claude session
# (Algorithm loads at session start)

# 3. Verify version
# Check banner shows: ♻︎ Entering the PAI ALGORITHM… (v3.13.0)
```

To rollback further (v3.12.0), be aware of breaking changes listed above. You may need to:
- Restore old hook logic for PRD management
- Update capability selection code
- Relax ISC atomicity requirements

## Testing Your Migration

After updating algorithm version:

1. **Test Standard Task**
   ```
   "Implement a simple feature with 2-3 files"
   ```
   Verify:
   - Capability consideration happens in OBSERVE
   - Selected capabilities actually invoke
   - ISC criteria are atomic
   - PRD writes directly from AI

2. **Test Extended Task**
   ```
   "Refactor module with tests and documentation"
   ```
   Verify:
   - PRD stub created
   - All seven phases execute
   - Criteria tracked correctly in PRD
   - Dashboard shows progress

3. **Test Capability Invocation**
   ```
   "Research [technical topic] and summarize"
   ```
   Verify:
   - Research capability selected in OBSERVE
   - Skill("Research") actually called in BUILD or EXECUTE
   - Results incorporated into VERIFY

## Getting Help

**Documentation:**
- Full algorithm: `~/.claude/PAI/Algorithm/v3.14.0.md`
- ISC methodology: `~/.claude/PAI/Algorithm/ISC-Methodology.md`
- Capability selection: `~/.claude/PAI/Algorithm/CapabilitySelection.md`

**Debugging:**
- Check `~/.claude/PAI/Algorithm/LATEST` for active version
- Review recent PRDs in `~/.claude/MEMORY/WORK/`
- Check `algorithm-reflections.jsonl` for LEARN phase output

**Issues:**
If you encounter algorithm bugs or edge cases, document in:
`~/.claude/MEMORY/FEEDBACK/algorithm-issues.md`

## Version-Specific Features

### v3.14.0 Features
- All v3.13.0 features (no additions)
- Version number incremented for tracking

### v3.13.0 Features
- Mandatory capability consideration
- Direct PRD writing (AI is sole writer)
- Capability invocation enforcement
- Closed capability list
- Enhanced atomicity rule
- Improved ISC decomposition methodology

### v3.12.0 Features (Deprecated)
- Advisory capability selection
- Hook-assisted PRD management
- Open capability references
- Multi-part ISC criteria allowed

## Future Versions

Algorithm evolution roadmap:
- v3.15.0: Planned enhanced verification patterns
- v3.16.0: Potential capability expansion
- v4.0.0: Future major revision (TBD)

Check `~/.claude/PAI/Algorithm/LATEST` regularly for updates.

## Summary

**Most users:** v3.13.0 → v3.14.0 is seamless, no action needed beyond updating LATEST.

**From v3.12.0 or earlier:** Review capability selection and PRD direct-write changes. Test thoroughly before production use.

**From v3.11.0 or earlier:** Significant changes. Review full v3.13.0 algorithm and migration checklist above.

**Current version stable:** v3.14.0 is production-ready and recommended for all users.
