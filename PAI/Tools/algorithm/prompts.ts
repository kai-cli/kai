/**
 * algorithm/prompts.ts - Prompt template builders for loop and interactive modes
 */

import { readPRD, countCriteria, extractPRDTitle } from "./state";

// ─── Iteration Prompt (Loop Mode) ────────────────────────────────────────────

export function buildIterationPrompt(prdPath: string, iteration: number, maxIterations: number): string {
  let mode = "loop";
  let effortLevel = "Standard";
  let lastPhase = "unknown";
  let failingList = "unknown — read the PRD to identify them";
  let verificationSummary = "unknown";

  try {
    const { frontmatter, content } = readPRD(prdPath);
    mode = frontmatter.mode || "loop";
    effortLevel = frontmatter.effort_level || "Standard";
    lastPhase = frontmatter.last_phase || "unknown";
    verificationSummary = frontmatter.verification_summary || "0/0";

    const criteria = countCriteria(content);
    if (criteria.failingIds.length > 0) {
      const failingDetails: string[] = [];
      for (const id of criteria.failingIds) {
        const lineMatch = content.match(new RegExp(`- \\[ \\] ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*`));
        if (lineMatch) {
          failingDetails.push(lineMatch[0].replace(/^- \[ \] /, ""));
        } else {
          failingDetails.push(id);
        }
      }
      failingList = failingDetails.join("\n  ");
    }
  } catch {
    // If PRD read fails, prompt still works with defaults
  }

  return `You are running inside The Algorithm — autonomous loop iteration.

PRD: ${prdPath}
Iteration: ${iteration} of ${maxIterations}
Mode: ${mode} (autonomous — no human interaction available)
Per-iteration effort level: ${effortLevel}
Last phase reached: ${lastPhase}
Current progress: ${verificationSummary}

Failing criteria:
  ${failingList}

Instructions:
1. Read the PRD. Focus on the IDEAL STATE CRITERIA section.
2. Read the CONTEXT section to understand the problem space and architecture.
3. Read the CHANGELOG section to understand what previous iterations accomplished.
4. Focus on 1-3 failing criteria with the highest priority (CRITICAL+AUTO first, then HIGH+AUTO, then GUIDED).
   Skip criteria marked MANUAL — they require interactive mode.
5. For each targeted criterion, read its Verify: method and execute it.
6. If a criterion has Verify: Custom — SKIP it (requires interactive mode).
7. After making changes, RE-VERIFY ALL criteria (not just the ones you worked on) to catch regressions.
8. Update the PRD:
   - Check off criteria that now pass: \`- [ ]\` → \`- [x]\`
   - Uncheck any criteria that regressed: \`- [x]\` → \`- [ ]\`
   - Update the STATUS table with current progress
   - Update frontmatter: verification_summary, failing_criteria, last_phase, updated
   - Append a CHANGELOG entry for this iteration:
     ### Iteration {N} — {date}
     - **Phase reached:** VERIFY
     - **Criteria delta:** +{added} / ~{modified} | {passing}/{total} passing
     - **Work done:** {1-3 bullet summary}
     - **Still failing:** [{ISC IDs}]
     - **Regression detected:** {Yes: which | No}
     - **Context for next iteration:** {what next agent needs}
   - If ALL non-Custom/non-MANUAL criteria pass, set frontmatter status to COMPLETE
   - If ONLY Custom/MANUAL criteria remain, set frontmatter status to BLOCKED
9. Be honest. If a criterion fails, leave it unchecked and explain why in the CHANGELOG.
10. Focus on SAFE INCREMENTS — make 1-3 criteria pass, verify everything, move on.`;
}

// ─── Parallel Agent Prompt ──────────────────────────────────────────────────

export function buildWorkerPrompt(
  prdPath: string,
  agentId: number,
  criterion: { id: string; description: string },
  iteration: number,
): string {
  let contextSection = "";
  let verifyLine = "";

  try {
    const { content } = readPRD(prdPath);
    // Extract CONTEXT section
    const ctxMatch = content.match(/## CONTEXT\n([\s\S]*?)(?=\n## (?!CONTEXT))/);
    if (ctxMatch) contextSection = ctxMatch[1].trim();
    // Extract the full criterion line with verification method
    const critLine = content.match(new RegExp(`- \\[ \\] ${criterion.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*`));
    if (critLine) verifyLine = critLine[0].replace(/^- \[ \] /, "");
  } catch {}

  return `You are a loop worker — a focused executor. Your ONLY job is to make ONE criterion pass.

YOUR CRITERION:
  ${verifyLine || `${criterion.id}: ${criterion.description}`}

PRD: ${prdPath}
Iteration: ${iteration} | Agent: ${agentId}

CONTEXT (from PRD):
${contextSection || "Read the PRD CONTEXT section for details."}

RULES — READ CAREFULLY:
- You are a WORKER, not the Algorithm. Do NOT run the Algorithm format.
- Do NOT create ISC criteria (TaskCreate). The criteria already exist.
- Do NOT write to the PRD file at all. No updateFrontmatter, no writeFileSync, no Edit/Write on the PRD path. The parent orchestrator handles ALL PRD updates (frontmatter AND checkboxes).
- Do NOT touch other criteria — ONLY yours.

YOUR WORKFLOW:
1. Read the PRD to understand the problem space and key files.
2. Read the specific files relevant to your criterion.
3. Make the MINIMUM changes needed to make your criterion pass.
4. Run the verification method (the Verify: part after the pipe).
5. After your fix, also verify ALL OTHER criteria in the PRD to catch regressions from your change.
   For each criterion, run its Verify: method and report the result.
6. Print your primary result: "RESULT: ${criterion.id} PASS" or "RESULT: ${criterion.id} FAIL: <reason>"
   Then print regression check results: "REGRESSION_CHECK: ISC-XX PASS" or "REGRESSION_CHECK: ISC-XX FAIL"
7. Do NOT edit the PRD file. The parent reads your stdout and updates the PRD.
8. That's it. Exit when done.`;
}

// ─── Interactive Prompt ──────────────────────────────────────────────────────

export function buildInteractivePrompt(prdPath: string): string {
  let title = "PRD";
  let verificationSummary = "unknown";
  let failingList = "Check the PRD for details";

  try {
    const { frontmatter, content } = readPRD(prdPath);
    title = extractPRDTitle(content);
    verificationSummary = frontmatter.verification_summary || "0/0";

    const criteria = countCriteria(content);
    if (criteria.failingIds.length > 0) {
      failingList = criteria.failingIds.join(", ");
    } else {
      failingList = "None — all passing";
    }
  } catch {}

  return `Work on this PRD: ${prdPath}

Title: ${title}
Progress: ${verificationSummary}
Failing: ${failingList}

Read the PRD, understand the IDEAL STATE CRITERIA, and make progress on the failing criteria. Update the PRD as you complete work.`;
}
