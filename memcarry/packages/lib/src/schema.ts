/**
 * Atom schema — the two-tier typed memory unit.
 *
 * Design constraints this encodes (from ARCHITECTURE.md §3 + §11 hardening):
 *  - Two types only for the MVP: `lesson` and `resume-state`. (on_action/value/confidence/
 *    supersedes/links are DEFERRED with P4/P5 — not in this schema yet.)
 *  - HEAD is recall-safe; the human-readable `claim` is tiny and structured WHEN→DO→BECAUSE.
 *  - The MATCH surface (`trigger`) is separate from the DISPLAY surface (`claim.action` etc.)
 *    so triggers never compete with readable payload for the truncation budget.
 *  - `provenance` is a first-class TRUST TIER: only human-confirmed / outcome-vindicated atoms
 *    may ever gain authority or be promoted (enforced later, but the field exists now).
 *  - resume-state separates VERIFIED facts from UNVERIFIED beliefs (anti-anchoring, §11 #6).
 *  - resume-state is keyed by (project, worktree/branch) via `origin` (concurrency, §11 #8).
 *  - `also_touched` records the multi-repo spread of a session (Phase −1 finding F3).
 */
import { z } from "zod";

/** Trust tier — descending. Only the top two may gain authority/promotion (enforced post-MVP). */
export const ProvenanceTier = z.enum([
  "human-confirmed", // user explicitly wrote or confirmed it
  "outcome-vindicated", // a recall preceded a verified-good outcome (post-MVP value loop)
  "model-asserted", // the model stated it during a turn
  "auto-captured", // mechanically derived from session activity (lowest trust)
]);
export type ProvenanceTier = z.infer<typeof ProvenanceTier>;

/** Scope drives visibility + (later) promotion. `global` = every project recalls it. */
export const Scope = z
  .string()
  .regex(/^(global|project:[A-Za-z0-9._-]+)$/, "scope must be 'global' or 'project:<name>'");

/**
 * Structured claim — WHEN <precondition> → DO <action> BECAUSE <consequence + dated evidence>.
 * precondition gates recall/trigger; action+because is the recall-safe display payload.
 */
export const Claim = z.object({
  when: z.string().min(1).describe("precondition — when this applies; gates recall"),
  do: z.string().min(1).describe("the action/rule to take"),
  because: z.string().min(1).describe("consequence + dated evidence anchor"),
});
export type Claim = z.infer<typeof Claim>;

/** Display budget: the rendered claim must survive the recall truncation cap with margin. */
export const CLAIM_DISPLAY_CAP = 500;

export function renderClaim(c: Claim): string {
  return `WHEN ${c.when} → DO ${c.do} BECAUSE ${c.because}`;
}

const baseFields = {
  id: z.string().min(1),
  scope: Scope,
  provenance: ProvenanceTier,
  trigger: z.array(z.string().min(1)).default([]).describe("MATCH surface — keywords/tags"),
  created: z.string().describe("ISO-8601"),
  updated: z.string().describe("ISO-8601"),
};

/** A durable lesson/rule. Promotes to global. */
export const LessonAtom = z.object({
  type: z.literal("lesson"),
  ...baseFields,
  claim: Claim,
  expand_when: z.string().optional().describe("rule telling the model when to fetch DETAIL"),
  detail: z.string().optional().describe("on-demand body; never counts against recall cap"),
  last_used: z.string().nullable().default(null),
  use_count: z.number().int().nonnegative().default(0),
});
export type LessonAtom = z.infer<typeof LessonAtom>;

/** Where a resume-state was captured — the concurrency/worktree key. */
export const Origin = z.object({
  repo_path: z.string().describe("absolute path; probes run with explicit -C this"),
  branch: z.string(),
  worktree: z.string().nullable().default(null),
  session_id: z.string().nullable().default(null),
  write_ts: z.string().describe("ISO-8601"),
});
export type Origin = z.infer<typeof Origin>;

/** Epistemic status for every belief field — anti-anchoring (§11 #6). */
export const Belief = z.object({
  text: z.string(),
  status: z.enum(["hypothesis", "conclusion", "ruled-out"]),
  evidence: z.string().optional(),
  as_of: z.string().describe("ISO-8601 — age drives re-confirm flagging"),
});
export type Belief = z.infer<typeof Belief>;

/**
 * A verifiable cursor fact. The probe layer fills `state` at load.
 * 3-state is mandatory (§11 #9): never collapse INDETERMINATE into DRIFTED.
 */
export const VerifiableFact = z.object({
  kind: z.enum(["git-branch", "gh-pr", "ping", "ssh"]),
  recorded: z.string().describe("what the cursor claims"),
  state: z.enum(["unverified", "verified", "drifted", "indeterminate"]).default("unverified"),
  observed: z.string().optional().describe("what the probe saw"),
  reason: z.string().optional().describe("for indeterminate"),
});
export type VerifiableFact = z.infer<typeof VerifiableFact>;

/** A live work cursor. One per (project, branch/worktree). Overwritten each session. */
export const ResumeStateAtom = z.object({
  type: z.literal("resume-state"),
  ...baseFields,
  origin: Origin,
  // HEAD cursor — the warm-start payload, injected first.
  next: z.string().describe("the literal next step (LLM-drafted, /end-confirmed)"),
  summary: z.string().describe("one-line where-we-are"),
  verified_facts: z.array(VerifiableFact).default([]),
  // DETAIL — mental model + spread, injected second.
  beliefs: z.array(Belief).default([]).describe("UNVERIFIED — tagged, never anchoring"),
  blockers: z.array(z.string()).default([]),
  also_touched: z.array(z.string()).default([]).describe("other repos/paths this session spanned (F3)"),
});
export type ResumeStateAtom = z.infer<typeof ResumeStateAtom>;

export const Atom = z.discriminatedUnion("type", [LessonAtom, ResumeStateAtom]);
export type Atom = z.infer<typeof Atom>;

/** Validate an unknown object into a typed Atom (throws on invalid). */
export function parseAtom(input: unknown): Atom {
  return Atom.parse(input);
}

/** Write-time guard: the rendered claim must fit the display cap with margin. */
export function assertClaimFits(c: Claim): void {
  const len = renderClaim(c).length;
  if (len > CLAIM_DISPLAY_CAP) {
    throw new Error(`claim renders to ${len} chars, exceeds display cap ${CLAIM_DISPLAY_CAP}`);
  }
}
