# ImplementSpec — Spec-to-Implementation Workflow

Reads an approved spec, generates Algorithm ISC criteria from requirements, and starts implementation.

## When to Use

Use when a spec has `status: approved` and you're ready to implement it.

## Pre-conditions

- Spec exists in `specs/` with `status: approved`
- All required sections present (Problem, Requirements, Acceptance Criteria)

## Steps

### 1. Load the spec

Read `specs/{spec-id-or-slug}.md`. Confirm `status: approved`. If `status: draft`, stop and ask the user to approve it first.

### 2. Extract requirements

Map each `REQ-N` requirement to a proposed ISC criterion:
- REQ format: `- [ ] REQ-N: [requirement text]`
- ISC format: `ISC-N: [end-state criterion, 8-12 words]`

### 3. Set spec status to `implementing`

Edit the spec frontmatter: `status: implementing`

### 4. Start the Algorithm

Invoke ALGORITHM mode with the extracted ISC criteria as the starting point for OBSERVE. The Algorithm's OBSERVE pre-flight will have already read the spec.

Reference the spec in the PRD Context section: `Spec: specs/{file} (PAI-NNN)`

### 5. On completion (LEARN phase)

When all ISC criteria pass, update the spec: `status: shipped`

## Algorithm Integration

The Algorithm's OBSERVE pre-flight includes a spec lookup:

> **Spec lookup:** If the task references a spec ID (PAI-NNN) or the task description matches a spec title in `specs/`, read the matching spec. If `status: approved`, import REQ-N requirements as ISC criteria and set `status: implementing`. Skip specs with `status: draft`.

This is handled automatically by the Algorithm when a spec is mentioned in the task or when ImplementSpec invokes it directly.
