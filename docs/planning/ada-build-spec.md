# ADA Build Spec — REGISTRY schema + generator (Group A, buildable)

> **Status:** BUILD SPEC · created 2026-06-22 · turns `ambient-domain-activation-design.md` (rev 2)
> from strategy into a buildable Group-A contract. **Read the rev-2 design first** — this doc does NOT
> re-decide the mechanism (T1 = gitignored `CLAUDE.local.md` → `@import` a REGISTRY-generated pack;
> human-confirmed write-back is phase 1b). It specifies the concrete pieces rev 2 left as prose:
> the REGISTRY field format, the parser contract, the generator I/O, the pack template + budget gate,
> and the drift-gate test shape.
> **Scope:** Group A only (the `ready`-able layer). Groups B/C and phase-2 (T4) remain as rev 2 has them.

## 0a. Reconciliation with `ada-native-first.md`

`ada-native-first.md` is now a historical design note, not the implementation source of truth for
Group A. It correctly validated the Claude-native mechanism (`CLAUDE.local.md` importing packs from
`~/.claude/ada/`) and correctly rejected a Group-A self-feeding loop. It incorrectly deferred the
generator path.

The generator path is the current decision because ADA's highest-risk facts are already centralized in
`PAI/USER/PROJECTS/REGISTRY.md`: repo paths, default branches, resources, and release/check-in notes.
Hand-written packs would duplicate those facts and reintroduce drift. Group A therefore builds:

- REGISTRY schema rows for the first adopters.
- A pure parser and generator.
- Generated packs/procedure configs outside MEMORY.
- Safe `CLAUDE.local.md` pointers.
- A `--check` drift gate with tests proving it can fail.

Native-first still informs the constraints: use Claude-native imports, keep ADA artifacts outside
MEMORY, and defer KAI/Auto Memory redundancy work to a separate session.

## 0. Why this doc exists

Rev 2 step 1 says *"Extend REGISTRY.md with structured fields: conventions, checkin_procedure,
gotchas."* That sentence is the whole spine but isn't specified — so the ADA items stayed `scoping`.
This pins the exact format + contracts so Group A becomes `ready`.

**Single source:** `PAI/USER/PROJECTS/REGISTRY.md` (personal, gitignored). The generator reads it and
emits everything else. No pack is ever hand-edited (the "duplicated logic drifts" class PAI has killed
3× — counts, PII, sync excludes).

## 1. REGISTRY schema extension

REGISTRY today uses per-repo `| Key | Value |` tables (`path`, `remote`, `default_branch`, `ci`,
`packages`, `resources`, `notes`). **Add three optional rows**, same table, same parser. Optional so
existing entries (feed_core, ExampleWRT, etc.) need no change and simply produce no ADA pack until filled.

| New row | Format | Feeds | Example (feed_bbf) |
|---------|--------|-------|--------------------|
| `conventions` | `;`-separated `key=value` clauses | T1 pack | `branch=usp_ui; commit=conventional; lang=C/ambiorix` |
| `checkin_procedure` | `\|`-separated ordered steps | T2 procedure card | `verify branch==usp_ui \| run obuspa smoke \| PR to usp_ui` |
| `gotchas` | `;`-separated short clauses | T1 pack | `Jenkins builds use release_v1.1 not usp_ui; never hand-edit bbfdm patches` |

**Why string-packed, not nested YAML:** REGISTRY is a markdown-table format with a line-oriented parser
(below). Keeping one value per row preserves that parser and the human-diffability. If a field outgrows
one line, that is the REGISTRY-scalability trigger (rev 2 premortem) to split the repo into
`PAI/USER/PROJECTS/repos/<repo>.md` — **not** to nest inside the table.

**Generator input set (10 repos today):** feed_bbf, feed_core, feed_yourcompany, kai, Knowledge,
yourcompany-mcp, YourCompany-Wiki, ExampleWRT, kai, Synergy. A repo with none of the 3 new rows is
**skipped** (no pack) — adoption is incremental.

## 2. Parser contract

`parseRegistry(markdown: string): RepoEntry[]` — pure, no I/O.

```ts
interface RepoEntry {
  key: string;                  // e.g. "feed_bbf" (from the **bold** row)
  path?: string;
  default_branch?: string;      // existing rows still parsed
  // ADA fields (undefined when the row is absent):
  conventions?: Record<string,string>;  // "a=b; c=d" → { a:"b", c:"d" }
  checkin_procedure?: string[];          // "x | y | z" → ["x","y","z"]
  gotchas?: string[];                    // "p; q"      → ["p","q"]
}
```

- A repo block starts at a `| **<key>** | |` row and ends at the next bold row or section heading.
- Unknown rows are preserved/ignored (forward-compatible — same fail-open stance as `payload-schema.ts`).
- `branch=` inside `conventions` must equal `default_branch` if both present → the generator **warns**
  on mismatch (catches the exact "PR to wrong branch" class). It does not silently pick one.

## 3. Generator I/O

`bun PAI/Tools/ada-generate.ts [--check]` — reads REGISTRY, writes three artifact classes.

| Output | Path | Content |
|--------|------|---------|
| Pack | `~/.claude/ada/packs/<repo>.md` | Rendered from the template (§4); the heavy context |
| Pointer | `<repo path>/CLAUDE.local.md` | Exactly one line: `@~/.claude/ada/packs/<repo>.md` |
| Procedure config | `~/.claude/ada/procedures/<repo>.json` | `{ branch, steps[], guard }` consumed by the GitHubWriteGuard T2 extension — see guard policy below |

**Procedure-config `guard` shape (T2 branch policy, decided §7):**
```json
{ "branch": "usp_ui", "steps": ["..."],
  "guard": { "hardBlock": ["sysevent_integration", "usp_ui"], "warnOnly": ["*"],
             "overrideEnv": "ADA_BRANCH_GUARD_OVERRIDE" } }
```
The GitHubWriteGuard extension: on a `git push` whose target is in `hardBlock` and the current branch
mismatches → `{decision:"block", message}` UNLESS `ADA_BRANCH_GUARD_OVERRIDE=1`, in which case it
allows but logs `{repo, current_branch, expected_branch, timestamp, action}`. Targets in `warnOnly`
emit an advisory only. Generated from REGISTRY, not hand-maintained.

- **Idempotent:** re-running with an unchanged REGISTRY writes nothing (compare-before-write, like
  BuildManifest/BuildSettings). `--check` exits non-zero if any artifact would change (the drift gate, §5).
- **Pointer safety:** the generator writes `CLAUDE.local.md` only if absent or already an ADA pointer
  (first line matches `@~/.claude/ada/packs/`). It never overwrites a hand-authored `CLAUDE.local.md`
  — it warns and skips. `core.excludesfile` already ignores `CLAUDE.local.md` globally (rev 2), so no
  per-repo `.gitignore` edits.
- **Never touches** the company/public repo tree beyond that one pointer line (leak-proof by construction).

## 4. Pack template + budget gate

```
# ADA pack: <repo key>   (generated from REGISTRY — do not edit)
Target branch: <default_branch>
Conventions: <conventions rendered as bullet lines>
Check-in: <checkin_procedure as ordered list>   # mirrors the T2 card
Gotchas: <gotchas as bullet lines>
Resources: <resources row, verbatim>
<!-- generated <git-sha of REGISTRY> -->
```

**Budget gate (rev-2 premortem):** hard cap **≤120 lines / ≤4 KB per pack**. The generator **fails the
build** if a rendered pack exceeds it — forcing high-frequency essentials into the pack and long-tail
detail into T3 on-demand retrieval. The cap is a constant in the generator + asserted by a test.

## 5. Drift gate + the test that must actually fail

Wire `ada-generate.ts --check` into CI + weekly maintenance (alongside the existing count/PII gates).

**The "gates must actually fail" test** ([[feedback_verify_gates_must_actually_fail]]):
1. Generate packs from a fixture REGISTRY into a temp dir → assert `--check` exits 0 (in sync).
2. Mutate one fixture pack (or REGISTRY field) → assert `--check` exits **non-zero**.
3. A pack rendered over-budget → assert the generator exits non-zero.

A gate that cannot be shown to fail is worse than none, so this test ships *with* the gate.

## 6. Build order (maps to rev-2 Groups)

**Group A (this spec — all `ready` after it lands):**
- A1: REGISTRY schema rows (§1) — doc/data change, zero code.
- A2: `parseRegistry()` + unit tests (§2).
- A3: `ada-generate.ts` read path: pack + pointer + procedure config + budget cap (§3, §4).
- A4: drift gate `--check` + the must-fail test (§5); wire into CI + weekly.

**Group B (after A — already specced in rev 2):** real per-repo pack content; GitHubWriteGuard T2
extension consuming `procedures/<repo>.json`; LocalContextFirst domain-match branch → inject content (T3).

**Group C (after B):** self-feeding human-confirmed capture (phase 1b); delegation injection for
Explore/Plan + SDK/background subagents.

## 7. Decisions (settled 2026-06-22)

1. **Pack location → `~/.claude/ada/packs/`** (DECIDED). Outside MEMORY so memory tooling never
   sweeps/compacts/classifies ADA artifacts — they are reusable *operational* context, not session
   memory. Reserve:
   - `~/.claude/ada/packs/` — stable generated pack files
   - `~/.claude/ada/cache/` — generated/transient indexes if needed
   - procedure config under `~/.claude/ada/procedures/<repo>.json` (§3)
2. **First adopters → feed_bbf + feed_yourcompany** (DECIDED). Highest re-teach cost, clear branch
   gotchas, real wrong-branch risk. **NOT PAI/KAI first** — too meta, recursion/confusion risk while
   the mechanism is unproven; they adopt deliberately once ADA is stable.
3. **Branch guards → hard-block only known-expensive failures** (DECIDED). T2 stays a targeted guard,
   not a broad workflow gate:
   ```json
   { "branchGuards": { "hardBlock": ["sysevent_integration", "usp_ui"], "warnOnly": ["*"] } }
   ```
   - hard-block `sysevent_integration`, `usp_ui` (concrete history + cost); warn-only everywhere else
     (telemetry without blocking normal dev).
   - **Escape hatch (required):** `ADA_BRANCH_GUARD_OVERRIDE=1` bypasses a hard-block but **logs
     loudly**: `{ repo, current_branch, expected_branch, timestamp, action }`. Keeps the guard
     practical without being an immovable blocker.

## Cross-references
- Strategy + feasibility: `ambient-domain-activation-design.md` (rev 2) — the authority on mechanism.
- Roadmap home: `ROADMAP-7.x.md` 7.4.0 ADA tier (T1/T2/T3 + generation spine).
- Doctrine: single-source generation (BuildManifest/BuildSettings), gates-must-fail, leak-proof packs.
