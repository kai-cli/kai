/**
 * Algorithm.test.ts - Tests for algorithm module decomposition
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";

// Import from the modular implementation
import { countCriteria, readPRD, extractPRDTitle } from "../PAI/Tools/algorithm/state";
import { buildIterationPrompt, buildInteractivePrompt } from "../PAI/Tools/algorithm/prompts";
import { partitionCriteria } from "../PAI/Tools/algorithm/parallel";
import type { CriteriaInfo } from "../PAI/Tools/algorithm/types";

const TEST_DIR = join(import.meta.dir, ".tmp-algorithm-test");

beforeAll(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {}
});

// ─── State Module Tests ──────────────────────────────────────────────────────

test("countCriteria parses ISC format", () => {
  const content = `
## IDEAL STATE CRITERIA

- [x] ISC-AUTH-1: JWT tokens work | Verify: test
- [ ] ISC-AUTH-2: Login page renders | Verify: grep
- [x] ISC-A-1: No SQL injection | Verify: scan
- [ ] ISC-CLI-1: Help command works | Verify: run
`;

  const result = countCriteria(content);
  expect(result.total).toBe(4);
  expect(result.passing).toBe(2);
  expect(result.failing).toBe(2);
  expect(result.failingIds).toEqual(["ISC-AUTH-2", "ISC-CLI-1"]);

  // Criteria are grouped by status: checked first, then unchecked
  const passing = result.criteria.filter(c => c.status === "passing");
  const failing = result.criteria.filter(c => c.status === "failing");

  expect(passing.length).toBe(2);
  expect(failing.length).toBe(2);
  expect(passing.some(c => c.id === "ISC-AUTH-1")).toBe(true);
  expect(passing.some(c => c.id === "ISC-A-1")).toBe(true);
  expect(failing.some(c => c.id === "ISC-AUTH-2")).toBe(true);
  expect(failing.some(c => c.id === "ISC-CLI-1")).toBe(true);
});

test("countCriteria handles legacy format", () => {
  const content = `
- [x] C1: Feature works
- [ ] C2: Tests pass
- [x] A1: No bugs
`;

  const result = countCriteria(content);
  expect(result.total).toBe(3);
  expect(result.passing).toBe(2);
  expect(result.failing).toBe(1);
});

test("extractPRDTitle extracts markdown title", () => {
  const content = `# Build Authentication System

Description goes here.`;

  const title = extractPRDTitle(content);
  expect(title).toBe("Build Authentication System");
});

test("readPRD parses frontmatter and content", () => {
  const testPrd = join(TEST_DIR, "test-prd.md");
  const prdContent = `---
prd: true
id: PRD-20260527-test
status: DRAFT
mode: loop
effort_level: Standard
iteration: 0
maxIterations: 128
loopStatus: null
last_phase: null
failing_criteria: []
verification_summary: 0/2
---

# Test PRD

## IDEAL STATE CRITERIA

- [ ] ISC-TEST-1: Feature works
- [ ] ISC-TEST-2: Tests pass
`;

  writeFileSync(testPrd, prdContent);

  const result = readPRD(testPrd);
  expect(result.frontmatter.prd).toBe(true);
  expect(result.frontmatter.id).toBe("PRD-20260527-test");
  expect(result.frontmatter.status).toBe("DRAFT");
  expect(result.content).toContain("# Test PRD");
  expect(result.content).toContain("ISC-TEST-1");
});

// ─── Prompts Module Tests ────────────────────────────────────────────────────

test("buildIterationPrompt generates valid prompt", () => {
  const testPrd = join(TEST_DIR, "iter-prd.md");
  const prdContent = `---
prd: true
id: PRD-20260527-iter
status: DRAFT
mode: loop
effort_level: Standard
iteration: 0
maxIterations: 128
loopStatus: null
last_phase: OBSERVE
failing_criteria: [ISC-TEST-1]
verification_summary: 0/1
---

# Iteration Test PRD

## IDEAL STATE CRITERIA

- [ ] ISC-TEST-1: Feature works | Verify: test
`;

  writeFileSync(testPrd, prdContent);

  const prompt = buildIterationPrompt(testPrd, 1, 128);
  expect(prompt).toContain("PRD: " + testPrd);
  expect(prompt).toContain("Iteration: 1 of 128");
  expect(prompt).toContain("Mode: loop");
  expect(prompt).toContain("ISC-TEST-1");
});

test("buildInteractivePrompt generates valid prompt", () => {
  const testPrd = join(TEST_DIR, "interactive-prd.md");
  const prdContent = `---
prd: true
id: PRD-20260527-interactive
status: DRAFT
mode: interactive
effort_level: Standard
iteration: 0
maxIterations: 128
loopStatus: null
last_phase: null
failing_criteria: [ISC-TEST-1]
verification_summary: 0/1
---

# Interactive Test PRD

## IDEAL STATE CRITERIA

- [ ] ISC-TEST-1: Feature works
`;

  writeFileSync(testPrd, prdContent);

  const prompt = buildInteractivePrompt(testPrd);
  expect(prompt).toContain("Work on this PRD");
  expect(prompt).toContain(testPrd);
  expect(prompt).toContain("ISC-TEST-1");
});

// ─── Parallel Module Tests ───────────────────────────────────────────────────

test("partitionCriteria distributes by domain", () => {
  const criteria: CriteriaInfo = {
    total: 6,
    passing: 0,
    failing: 6,
    failingIds: ["ISC-AUTH-1", "ISC-AUTH-2", "ISC-CLI-1", "ISC-CLI-2", "ISC-DB-1", "ISC-API-1"],
    criteria: [
      { id: "ISC-AUTH-1", description: "Login works", status: "failing" },
      { id: "ISC-AUTH-2", description: "Logout works", status: "failing" },
      { id: "ISC-CLI-1", description: "Help shows", status: "failing" },
      { id: "ISC-CLI-2", description: "Version shows", status: "failing" },
      { id: "ISC-DB-1", description: "DB connects", status: "failing" },
      { id: "ISC-API-1", description: "API responds", status: "failing" },
    ],
  };

  const assignments = partitionCriteria(criteria, 4);

  // Should create 4 agents (one per domain)
  expect(assignments.length).toBe(4);

  // Each agent should have criteria from the same domain
  for (const assignment of assignments) {
    expect(assignment.criteriaIds.length).toBeGreaterThan(0);
    // Extract domains from assigned criteria
    const domains = assignment.criteriaIds.map(id => {
      const match = id.match(/^ISC-(.+)-\d+$/);
      return match ? match[1] : id;
    });
    // All criteria should be from the same domain
    const firstDomain = domains[0];
    expect(domains.every(d => d === firstDomain)).toBe(true);
  }
});

test("partitionCriteria caps agents at domain count", () => {
  const criteria: CriteriaInfo = {
    total: 2,
    passing: 0,
    failing: 2,
    failingIds: ["ISC-AUTH-1", "ISC-CLI-1"],
    criteria: [
      { id: "ISC-AUTH-1", description: "Login works", status: "failing" },
      { id: "ISC-CLI-1", description: "Help shows", status: "failing" },
    ],
  };

  // Request 4 agents but only 2 domains exist
  const assignments = partitionCriteria(criteria, 4);

  // Should only create 2 agents (one per domain)
  expect(assignments.length).toBe(2);
});

test("partitionCriteria returns empty for no failing criteria", () => {
  const criteria: CriteriaInfo = {
    total: 2,
    passing: 2,
    failing: 0,
    failingIds: [],
    criteria: [
      { id: "ISC-AUTH-1", description: "Login works", status: "passing" },
      { id: "ISC-CLI-1", description: "Help shows", status: "passing" },
    ],
  };

  const assignments = partitionCriteria(criteria, 4);
  expect(assignments.length).toBe(0);
});

// ─── Integration Tests ───────────────────────────────────────────────────────

test("full workflow: parse PRD, count criteria, build prompts", () => {
  const testPrd = join(TEST_DIR, "workflow-prd.md");
  const prdContent = `---
prd: true
id: PRD-20260527-workflow
status: DRAFT
mode: loop
effort_level: Extended
iteration: 0
maxIterations: 64
loopStatus: null
last_phase: null
failing_criteria: [ISC-TEST-1, ISC-TEST-2]
verification_summary: 0/2
---

# Workflow Test PRD

## IDEAL STATE CRITERIA

- [ ] ISC-TEST-1: Feature A works | Verify: test
- [ ] ISC-TEST-2: Feature B works | Verify: grep
`;

  writeFileSync(testPrd, prdContent);

  // 1. Read PRD
  const prd = readPRD(testPrd);
  expect(prd.frontmatter.id).toBe("PRD-20260527-workflow");

  // 2. Count criteria
  const criteria = countCriteria(prd.content);
  expect(criteria.total).toBe(2);
  expect(criteria.failing).toBe(2);

  // 3. Build iteration prompt
  const prompt = buildIterationPrompt(testPrd, 1, 64);
  expect(prompt).toContain("ISC-TEST-1");
  expect(prompt).toContain("ISC-TEST-2");
  expect(prompt).toContain("Extended");
});
