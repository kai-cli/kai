# Incident Retrospective — the "seed" repo-wipe (2026-06-22)

> **Status:** RETROSPECTIVE · severity: HIGH (potential), **ZERO actual data loss** · contained by PR discipline.
> **One-line:** a scaffolding-style operation ran inside a Claude-created git **worktree**, committed a
> repo-wiping "seed" commit under a junk `T <t@t.t>` identity, and flipped the main repo to `core.bare`.
> Caught immediately because the work was on a feature branch behind a PR, never on `main`.

## 1. What happened (timeline, from reflog)

| Time | Event |
|------|-------|
| ~14:00 | To avoid colliding with a parallel Codex agent in the **shared single checkout**, Claude created a second git **worktree** `~/Projects/kai-74` on `fix/7.4.0-continue`. |
| 15:31 | That worktree's HEAD reset to bare `main` (`0ec97cf`). |
| ~15:40 | Claude did legit work there: cherry-picked §5c, wrote ADA spec → commits `d702bd0`, `68c794e` (author: KAI Maintainer). |
| **15:57** | **A "seed" operation ran in `kai-74`:** wrote `user.name=T / user.email=t@t.t` into the **shared** `.git/config`, committed `dfaf159 "seed"` — **deleted 1894 files / 365,013 lines**, leaving a single `README.md` containing `# seed`. Also flipped `core.bare=true`. |
| ~16:10 | Claude's next doc commit (`7072b89`) inherited the junk `T <t@t.t>` author from the poisoned config. |
| ~16:15 | Pushed `fix/7.4.0-continue` → **PR #8** showed **1894 files, −364,799**. User: "PR8 is a total mess." |
| 16:20+ | Diagnosis: identified `seed` + `t@t.t` + `core.bare=true` as the three corruptions. Restored identity, fixed `core.bare`, salvaged the 3 good commits onto a clean `fix/7.4.0-specs`, removed the worktree. |

## 2. The three distinct corruptions

1. **`dfaf159 "seed"` commit** — replaced the entire repo tree with a one-line `# seed` README. Signature of a "scaffold a new project / `git init` + seed" tool run in the wrong directory.
2. **Junk git identity** — `[user] name=T email=t@t.t` written into `kai/.git/config` (shared by all worktrees), mis-stamping subsequent legitimate commits.
3. **`core.bare=true`** — flipped on the working repo, which broke ALL subsequent `git checkout`/branch ops ("fatal: this operation must be run in a work tree") until reset.

## 3. Root cause

**An automated scaffolding operation executed inside a live Claude-created worktree**, treating it as an
empty target for a new repo: it set a placeholder identity, committed a seed tree (wiping existing files),
and configured the repo as bare. The exact tool is unconfirmed (the deleted set included `.agnixignore`,
hinting at an `agnix`-style agent harness), but the **mechanism is clear and the fix did not require
knowing the tool**.

**Why the worktree was the enabling condition:** the extra worktree was created to dodge a *different*
problem (two agents sharing one checkout). It introduced an unexpected, loosely-watched directory that a
background tool could act in — trading a known collision risk for a worse, unmonitored one.

## 4. Why impact was ZERO

- **PR discipline.** The wipe landed on a feature branch (`fix/7.4.0-continue`), never on `main`. The PR
  diff (1894 files / −364k) made it instantly, glaringly visible. **This is the single biggest reason there
  was no loss.** (User: "thank god we are using PRs.")
- **Git is content-addressable.** Nothing was actually destroyed — the real tree lived in history; "seed"
  was just a bad commit on top. Salvage = cherry-pick the 3 good commits, drop the seed.
- **The corruption was local** (repo config + one branch), never pushed to `main`, never global.

## 5. What went well

- PR-per-change workflow contained a repo-wipe to a reviewable diff.
- Reflog + `git diff --stat` made the forensic timeline recoverable.
- The damage was config + commits — all reversible; no force-push to main, no history rewrite needed.

## 6. What went wrong / lessons

- **L1 — Creating a worktree to avoid agent collision was the wrong tradeoff.** It added an unmonitored
  directory. Better: one checkout, explicit turn-taking, or fully separate clones — not a worktree sharing
  the same `.git/config` (so identity/`core.bare` pollution affects *both*).
- **L2 — Shared `.git/config` across worktrees is a blast-radius multiplier.** A tool poisoning config in
  the worktree corrupted the main checkout too.
- **L3 — No guard caught `core.bare=true` / identity flips.** These are high-signal corruptions with no
  detector today.
- **L4 — `--no-verify` pushes from a flaky worktree** (earlier in the session) normalized bypassing gates;
  a seed commit could in principle ride along. The pre-push gate should also sanity-check the diff size.

## 7. Prevention (implemented in PR #10)

| # | Guard / action | Status |
|---|----------------|--------|
| P1 | **Pre-push large-deletion sanity gate** — blocks a push range deleting more than `PAI_DELETE_THRESHOLD` files; `PAI_ALLOW_LARGE_DELETE=1` override is logged. A repo-wipe "seed" would be blocked. | ✅ Implemented in `scripts/hooks/pre-push` |
| P2 | **Author-identity guard** — rejects commits authored outside the maintainer allowlist; catches `t@t.t`. `PAI_ALLOW_AUTHOR=1` is the explicit override. | ✅ Implemented in `scripts/hooks/pre-push` |
| P3 | **`core.bare` canary** — runs before `git rev-parse --show-toplevel` and blocks with an explicit diagnostic when `core.bare=true`. | ✅ Implemented in `scripts/hooks/pre-push` |
| P4 | **No shared-`.git` worktrees for agent isolation** — use one checkout with turn-taking, or fully separate clones. | ✅ Captured as the process lesson from this incident |
| P5 | **Tool sandboxing** — scaffolding/`git init`/"seed" tools should refuse to run in a directory that already contains a `.git` with commits. | ⏳ External/upstream follow-up |

`tests/RepoSafetyGuards.test.ts` proves the guards are wired and includes a real R3 failure-path test:
the actual pre-push hook runs in a `core.bare=true` temp repo and must emit the explicit canary
diagnostic instead of crashing at `git rev-parse`.

## 8. Follow-up actions

- [x] Restore git identity (KAI Maintainer) + fix `core.bare=false` — DONE.
- [x] Salvage the 3 good commits → clean `fix/7.4.0-specs`; remove the worktree; delete poisoned local branch — DONE.
- [x] Close PR #8 + delete remote `origin/fix/7.4.0-continue` (the poisoned branch) — DONE.
- [x] Build P1/P2/P3 prevention guards in PR #10 — DONE.
- [x] Confirm no other Claude/Codex worktrees exist (`git worktree list` shows the single checkout) — DONE.
