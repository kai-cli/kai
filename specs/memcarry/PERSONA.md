# Persona Definition — Tier 1 (capability scoping)

> **Written 2026-06-15.** Tier 1 of the two-tier persona plan: YourName defines the four-hats capability
> set up front (this doc) → Tier 2 refines by real usage data (tracking added now, decisions later).
> **Goal (YourName's words):** "reduce noise and clean up signal… reduce some and cleanup/combine others so
> we don't have so many branching tools… it feels overwhelming." Side goal: lighter/faster via the rewrite.
> **Grounding:** ROLE_CONTEXT = EM/PLM Director, YourCompany (firmware + frontend teams), TR-069/369 cert,
> build modernization, security/privacy focus. Four hats: TPM · PM · QA · Engineer.

## The problem this scopes
47 top-level skills (+20 agents). The system was built generically ("not built for us") and accreted
extraneous tools + overlapping clusters. The noise is two kinds: (1) tools that don't serve an EM/PLM,
(2) multiple "doors to the same room" (e.g. 4 research skills, 5 thinking skills). Target: **47 → ~22**.

## DECISIONS LOCKED (2026-06-15)
1. **Cut all extraneous** (confirmed): tools that don't serve the role — delete/archive.
2. **Combine overlapping clusters** into single moded skills (the main "branching tools" fix).
3. **Trim rarely-used situational** — but by EVIDENCE (Tier 2), not guess.
4. **Tier 2 = add lightweight skill-invocation tracking now; revisit cuts in weeks with real data.**
   (Telemetry today is too sparse to mine — 15k transcripts but skill calls aren't cleanly logged.)
5. Execution = part of the rewrite, NOT a destructive sweep now. This doc is the TARGET, not a delete list to run today.

## 🔴 CUT (7) — don't serve an EM/PLM at YourCompany
`OSINT` · `PrivateInvestigator` · `WorldThreatModelHarness` · `AudioEditor` · `USMetrics`
(YourName confirmed all 5 cuttable) + `Apify` · `BrightData` (social-media/e-commerce scraping — not the domain).

## How skills + sub-modes are invoked (the mechanism merges rely on)
Skills are **intent-routed by natural language**, not called by path. Each SKILL.md has a routing table
mapping trigger phrases → a `Workflows/*.md` mode. Example (Research, today): "research X"→Standard,
"quick research"→Quick, "extensive/deep research"→Extensive, "deep investigation/map the landscape"→
Iterative. You can also force one with the slash form `/research`; phrasing still selects the mode.

**MERGE DESIGN PRINCIPLE (from YourName's Q 2026-06-15):** a merge = fold sub-skills in as MODES of the
parent, each KEEPING a discoverable trigger phrase in the parent's routing table. A merge is only good
if every former skill's capability stays reachable by an obvious phrase — otherwise it hides capability
behind un-guessable phrasing. This is WHY Research + Security are flagged ⚠️: their modes are used
distinctly, so their trigger phrases must survive the merge intact (or keep them split).

## 🟠 COMBINE — collapse overlapping clusters into one moded skill each
> Per-cluster boundaries to be CONFIRMED at merge time (the merge-check question was left open — don't
> assume a cluster is safe to collapse until confirmed; Security especially, given it's a focus area).
> Each merged sub-mode MUST retain a discoverable trigger phrase (see merge design principle above).

| Cluster (merge) | → Target | Rationale | Confirm-before-merge? |
|---|---|---|---|
| Research, Deliberate, Council, Investigation | **Research** (modes) | all multi-source/multi-model research | ⚠️ confirm Deliberate/Council distinct use |
| Thinking, FirstPrinciples, BeCreative, IterativeDepth, Science | **Thinking** (modes) | all analytical/creative thinking modes | low risk |
| Scraping, BrightData*, Apify*, Parser | **Scraping** | web-extraction variants (*also in cut list) | low risk |
| ContentAnalysis, ExtractWisdom, Fabric | **ContentAnalysis** | content extraction / wisdom — heavy overlap | low risk |
| Security, WebAssessment, RedTeam, PromptInjection, SECUpdates | **Security** (sub-modes) | 5 entries, ONE focus area | ⚠️ YourName may want these split (focus area) |

## 🟢 KEEP standalone — distinct + core to the hats (~22 after merges)
**Engineer:** YourCompanyDev, WikiQuery, Development, CreateCLI, CreateSkill
**QA:** Evals (+ QATester agent)
**PM/analysis:** Research (merged), Thinking (merged), ContentAnalysis (merged)
**Security (focus area):** Security (merged or split — TBD)
**System/meta (run the harness):** PAI, Telos, Curate, Evolve, End, Automate, Delegation, DevTeam, Agents, KAIUpgrade, Prompting
**Situational-but-kept:** Media, Documents, Browser, Cloudflare

## Hat → capability map (the "what serves me" record)
- **TPM** (program/release/risk/stakeholder): Telos, Delegation, DevTeam, End, Automate + the ProductStrategist/StakeholderCommunicator agents
- **PM** (roadmap/specs/prioritize): Development, Research, Thinking, ContentAnalysis + ProductStrategist/TechnicalReviewer agents
- **QA** (test/validate/verify): Evals, Security, Browser + QATester/UIReviewer agents
- **Engineer** (firmware/code/build/debug): YourCompanyDev, WikiQuery, Development, CreateCLI, CreateSkill, Browser + Engineer/Architect agents

## Tier 2 — evidence-based refinement (next)
- **✅ DONE — tracking live:** `hooks/SkillTracker.hook.ts` (commit 976f023) logs every Skill invocation
  to `MEMORY/STATE/skill-usage.jsonl` ({ts, skill, project, session}).
- **✅ DONE — reminder live:** `statusline.ts` `checkPersonaReview()` surfaces a `persona_review` ⚡ ACTION
  **21 days** after the window opened (anchored 2026-06-15 via `MEMORY/STATE/.persona-review.json`),
  showing accrued invocation count as context. Snooze by setting `snoozeUntil` (epoch ms) in that state
  file; reset the window by setting `windowOpened` to now after a review.
- **Then (when the reminder fires):** review counts —
  `jq -r .skill MEMORY/STATE/skill-usage.jsonl | sort | uniq -c | sort -rn` — cut genuinely-unused
  situational skills, confirm merge boundaries against real usage, reconsider any 🟢 that never fires.

## Out of scope of THIS doc
- The actual merging/cutting (that's rewrite execution — needs per-cluster confirmation + careful migration).
- Agents (20) — a separate surface; same persona lens applies later.
- Hooks/lib consolidation (that's the W-series cleanup, mostly already done — see NEXT-STEPS.md).
