#!/usr/bin/env bun
/**
 * `mem` CLI — what HOOKS shell out to (hooks CANNOT call MCP tools; see
 * constraint_claude_hooks_cannot_call_mcp). Imports @memcarry/lib directly so it works with the MCP
 * server down. Commands:
 *   health                         — store stats
 *   resume <project> [--start DIR] — inject-cached resume payload (SessionStart) + kick async verify
 *   drift <project> [--session S]  — consume + render drift (UserPromptSubmit), read-once
 *   capture <project> --transcript F [--slug S] [--device H]  — draft+write resume-state (SessionEnd)
 *   recall "<prompt>" [--project P]— top-K lesson HEADs (UserPromptSubmit)
 *   duplicates                     — read-only duplicate-lesson report
 *   write <atom.json>              — write a validated atom (scope is a write-time choice)
 *   capture-lesson --when W --do D --because B [--trigger a,b] [--scope global] [--apply]
 *                                  — capture a session learning as a lesson atom (spec 005); dry-run
 *                                    previews + dup-checks, --apply writes (the human-confirm gate)
 */
import {
  readAllAtoms, parseAtom, writeAtom, renderClaim, atomPath,
  resolveActiveProject, resumeStateId,
  verifyAndWriteDrift, consumeDrift, renderDrift,
  captureResumeState, recall, findDuplicates,
  findLessonById, refineLesson, EmptyRefineError,
  buildLessonAtom, EmptyLessonError,
  type Atom, type ResumeStateAtom,
} from "@memcarry/lib";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

const STORE = process.env.MEMCARRY_STORE ?? join(import.meta.dir, "..", "..", "..", "store");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const out = (o: unknown) => console.log(JSON.stringify(o, null, 2));

function health() {
  const atoms = readAllAtoms(STORE);
  const byType: Record<string, number> = {};
  for (const a of atoms) byType[a.type] = (byType[a.type] ?? 0) + 1;
  out({ ok: true, store: STORE, atoms: atoms.length, byType });
}

function findResume(project: string): ResumeStateAtom | undefined {
  return readAllAtoms(STORE).find(
    (a): a is ResumeStateAtom => a.type === "resume-state" && a.scope === `project:${project}`
  );
}

/**
 * SessionStart: print the cached payload IMMEDIATELY, then DETACH verification into a separate
 * background process and return. The hook never waits on probes — this is the real fix for the
 * SessionStart-hang (build review riskiest-unknown #2). The detached `verify` worker writes the
 * drift file; the next UserPromptSubmit (`drift`) consumes it.
 */
function resume(project: string) {
  const atom = findResume(project);
  if (!atom) {
    out({ found: false, project });
    return;
  }
  // Inject cached payload now — zero blocking probes.
  out({
    found: true,
    project,
    cursor: { next: atom.next, summary: atom.summary, also_touched: atom.also_touched },
    beliefs: atom.beliefs, // already epistemic-tagged
    blockers: atom.blockers,
    verified_facts: atom.verified_facts.map((f) => ({ kind: f.kind, recorded: f.recorded })),
    note: "verify-at-load running async (detached); drift surfaces on next prompt",
  });

  // Detach the verify worker: fully decoupled child, stdio ignored, unref'd so we exit immediately.
  const childArgs = [
    "run", import.meta.path, "verify", project,
    "--start", flag("start") ?? process.cwd(),
    "--session", flag("session") ?? "nosession",
  ];
  if (flag("slug")) childArgs.push("--slug", flag("slug")!);
  if (flag("device")) childArgs.push("--device", flag("device")!);
  if (flag("budget")) childArgs.push("--budget", flag("budget")!);
  try {
    const child = spawn("bun", childArgs, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    /* if we can't spawn, the cached payload already shipped — degrade silently */
  }
}

/** Detached verify worker (spawned by `resume`). Runs probes under budget, writes the drift file. */
async function verify(project: string) {
  const proj = resolveActiveProject(flag("start"));
  const atom = findResume(project);
  if (!atom) return;
  try {
    await verifyAndWriteDrift(atom, {
      currentBranch: proj.branch,
      sessionId: flag("session") ?? null, // LIVE session — must match the drift-read key
      ghSlug: flag("slug"),
      host: flag("device"),
      totalBudgetMs: Number(flag("budget") ?? 800),
    });
  } catch {
    /* never throw from the detached worker */
  }
}

function drift(project: string) {
  const d = consumeDrift(project, flag("session") ?? null);
  if (!d) {
    out({ drift: null });
    return;
  }
  const atom = findResume(project);
  out({ drift: d, annotation: atom ? renderDrift(d, atom.next) : renderDrift(d, "") });
}

function doCapture(project: string) {
  const transcript = flag("transcript");
  if (!transcript) {
    console.error("usage: mem capture <project> --transcript <file> [--slug owner/repo] [--device host]");
    process.exit(2);
  }
  const proj = resolveActiveProject(flag("start"));
  const res = captureResumeState(transcript, { ...proj, name: project }, {
    nowIso: new Date().toISOString(),
    ghSlug: flag("slug"),
    deviceHost: flag("device"),
  });
  if (!res.substantive) {
    out({ captured: false, reason: "session not substantive (F1 gate)" });
    return;
  }
  const path = writeAtom(STORE, res.atom!);
  out({ captured: true, id: res.atom!.id, path, next: res.atom!.next, also_touched: res.atom!.also_touched });
}

function doRecall(prompt: string) {
  const hits = recall(readAllAtoms(STORE), prompt, flag("project") ?? null, Number(flag("k") ?? 5));
  out({ hits });
}

function duplicates() {
  out({ pairs: findDuplicates(readAllAtoms(STORE), Number(flag("threshold") ?? 0.6)) });
}

function write(file: string) {
  const atom: Atom = parseAtom(JSON.parse(readFileSync(file, "utf8")));
  const path = writeAtom(STORE, atom);
  out({ written: true, id: atom.id, scope: atom.scope, path });
}

/**
 * `/end` confirm surface (addresses smoke finding S2: 45% of real sessions have no PR/issue anchor,
 * so the next/why MUST be confirmable, not mechanical-only). Prints the current draft resume-state's
 * next/why for the /end skill to show the user. With --next "..." it COMMITS a user-edited next line
 * and upgrades provenance auto-captured → human-confirmed (so it can later earn authority).
 */
function confirm(project: string) {
  const atom = findResume(project);
  if (!atom) { out({ found: false, project }); return; }
  const newNext = flag("next");
  if (newNext === undefined) {
    // show the draft for the user to review/edit
    out({
      project, id: atom.id, provenance: atom.provenance,
      draft_next: atom.next, draft_summary: atom.summary,
      needs_confirm: atom.provenance === "auto-captured",
      hint: 'edit with: memcarry confirm ' + project + ' --next "your real next step"',
    });
    return;
  }
  const updated: ResumeStateAtom = {
    ...atom,
    next: newNext,
    provenance: "human-confirmed",
    updated: new Date().toISOString(),
  };
  const path = writeAtom(STORE, updated);
  out({ confirmed: true, id: updated.id, next: updated.next, provenance: updated.provenance, path });
}

/**
 * `refine` — backflow (spec 004): improve a GLOBAL lesson so the change propagates to every project.
 * Two-step, mirrors `confirm`: DRAFT (no --apply) shows current claim + proposed diff, writes nothing;
 * --apply runs refineLesson + writeAtom (same id ⇒ overwrites). The --apply gate IS the human-confirm
 * anti-loop guarantee — the model only passes --apply after the user says yes.
 */
function refine(atomId: string) {
  const atom = findLessonById(STORE, atomId);
  if (!atom) {
    out({ ok: false, error: `no global lesson with id '${atomId}' (backflow targets global lessons only)` });
    process.exit(1);
  }
  const newDo = flag("do");
  const becauseAppend = flag("because");

  // DRAFT mode: show what would change, write nothing.
  if (process.argv.indexOf("--apply") === -1) {
    let proposed: string | null = null;
    try {
      if (newDo !== undefined || becauseAppend !== undefined) {
        proposed = renderClaim(refineLesson(atom, { do: newDo, becauseAppend }, new Date().toISOString()).claim);
      }
    } catch { /* draft preview only — ignore EmptyRefine in dry mode */ }
    out({
      id: atom.id, scope: atom.scope, provenance: atom.provenance,
      current: renderClaim(atom.claim),
      proposed,
      willWrite: false,
      hint: `apply with: memcarry refine ${atom.id} --do "..." --because "..." --apply`,
    });
    return;
  }

  // APPLY mode: the human-confirm gate has been crossed.
  try {
    const updated = refineLesson(atom, { do: newDo, becauseAppend }, new Date().toISOString());
    const path = writeAtom(STORE, updated);
    out({
      refined: true, id: updated.id, path,
      provenance: updated.provenance, last_refined: updated.last_refined,
      claim: renderClaim(updated.claim),
    });
  } catch (e) {
    const msg = e instanceof EmptyRefineError ? e.message : (e as Error).message;
    out({ ok: false, error: msg });
    process.exit(1);
  }
}

/**
 * `capture-lesson` — capture (spec 005): turn a session learning into a GLOBAL (or project) lesson atom,
 * the FORWARD half of the cross-project cycle (refine is the backflow half). Two-step, mirrors `refine`:
 * DRAFT (no --apply) builds + previews the lesson, runs the recall dup check + exact-id collision guard,
 * and writes NOTHING; --apply writes via writeAtom. The --apply gate IS the human-confirm anti-loop
 * guarantee — the model passes --apply only after the user confirms. Scope defaults to global (FR1).
 */
function captureLesson() {
  const draft = {
    when: flag("when") ?? "",
    do: flag("do") ?? "",
    because: flag("because") ?? "",
    trigger: (flag("trigger") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    scope: flag("scope") ?? "global",
  };

  // Build first — a malformed/empty draft fails here (FR5) with no write, in both dry and apply mode.
  let atom: Atom;
  try {
    atom = buildLessonAtom(draft, new Date().toISOString());
  } catch (e) {
    const msg = e instanceof EmptyLessonError ? e.message : (e as Error).message;
    out({ ok: false, error: msg });
    process.exit(1);
  }

  // Dup check (FR6): reuse the shipped recall as the near-duplicate detector (keyword-only here, same as
  // `doRecall`). A strong hit means "you may already have this — refine instead" (routes to spec 004).
  const probe = `${draft.do} ${draft.because} ${draft.trigger.join(" ")}`;
  const similar = recall(readAllAtoms(STORE), probe, null, 3)
    .filter((h) => h.id !== atom.id)
    .map((h) => ({ id: h.id, claim: h.claim, score: h.score }));
  // Exact-id collision (FR6): same claim already on disk ⇒ surface it, don't silently overwrite.
  const collision = existsSync(atomPath(STORE, atom));

  // DRAFT mode: preview + signals, write nothing.
  if (process.argv.indexOf("--apply") === -1) {
    out({
      id: atom.id, scope: atom.scope, provenance: atom.provenance,
      proposed: renderClaim(atom.claim),
      willWrite: false,
      collision,
      similar,
      hint: collision
        ? `this exact lesson id already exists — refine it instead: memcarry refine ${atom.id} --because "..." --apply`
        : similar.length
          ? `similar lesson(s) exist — refine one instead, OR apply to capture new: memcarry capture-lesson ... --apply`
          : `apply with: memcarry capture-lesson --when "..." --do "..." --because "..." --apply`,
    });
    return;
  }

  // APPLY mode: the human-confirm gate has been crossed.
  const path = writeAtom(STORE, atom);
  out({ captured: true, id: atom.id, scope: atom.scope, provenance: atom.provenance, path, claim: renderClaim(atom.claim) });
}

const [cmd, arg] = process.argv.slice(2);
const need = (label: string) => {
  if (!arg) { console.error(`usage: mem ${label}`); process.exit(2); }
  return arg;
};

switch (cmd) {
  case "health": health(); break;
  case "resume": resume(need("resume <project>")); break;
  case "verify": await verify(need("verify <project>")); break;
  case "drift": drift(need("drift <project>")); break;
  case "capture": doCapture(need("capture <project> --transcript <file>")); break;
  case "recall": doRecall(need('recall "<prompt>"')); break;
  case "duplicates": duplicates(); break;
  case "write": write(need("write <atom.json>")); break;
  case "confirm": confirm(need('confirm <project> [--next "..."]')); break;
  case "refine": refine(need('refine <atomId> [--do "..."] [--because "..."] [--apply]')); break;
  case "capture-lesson": captureLesson(); break;
  default:
    console.error("commands: health | resume | verify | drift | capture | recall | duplicates | write | confirm | refine | capture-lesson");
    process.exit(2);
}
