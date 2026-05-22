# WriteSpec — Spec Authoring Workflow

Guides authoring of a PAI feature spec with structure enforcement.

## When to Use

Use before starting any new feature that benefits from written requirements upfront. Specs are optional but recommended for features with >3 requirements or uncertain scope.

## Steps

### 1. Gather the spec ID

- Check existing specs in `specs/` for the next available PAI-NNN ID
- Format: `PAI-` + zero-padded 3-digit number (e.g., PAI-601, PAI-602)

### 2. Create the spec file

Write `specs/{slug}.md` using this template:

```markdown
---
id: PAI-NNN
type: feature | bug | refactor | infra
status: draft
priority: high | medium | low
---

# Feature Name

## Problem
[What problem does this solve? Why is it worth doing?]

## Requirements
- [ ] REQ-1: [Specific, testable requirement]
- [ ] REQ-2: [Another requirement]

## Design
[Technical approach, key decisions, constraints, alternatives rejected]

## Files Affected
[Specific file paths and what changes in each]

## Acceptance Criteria
[Maps directly to ISC criteria the Algorithm will use]
[Each criterion should be binary testable]
```

### 3. Validate required sections

All sections must be present before setting `status: draft`:
- [ ] `id` frontmatter set
- [ ] `type` frontmatter set
- [ ] `Problem` section describes the user need
- [ ] `Requirements` section has ≥1 REQ-N items
- [ ] `Acceptance Criteria` section present

### 4. Set status to `draft`

Specs start as `draft`. Only set to `approved` after human review. The Algorithm will only auto-import specs with `status: approved`.

## Status Lifecycle

| Status | Meaning | Transition |
|--------|---------|------------|
| `draft` | Work in progress | Manual: set to `approved` after review |
| `approved` | Ready for implementation | Auto: Algorithm sets to `implementing` |
| `implementing` | Algorithm is working on it | Auto: Algorithm sets to `shipped` on completion |
| `shipped` | Implementation complete | Terminal state |
