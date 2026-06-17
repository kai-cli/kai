# Contracts — Backflow refine surfaces

Surfaces over one pure `refineLesson()`: CLI (manual + the apply path), the model's mid-turn proposal,
End-skill (safety net). All preserve the human-confirm gate. **NO MCP** — the MemCarry MCP server is an
unregistered stub Claude can't call; backflow uses the proven CLI+hooks path.

## C1 — CLI: `memcarry refine` (NEW)
Mirrors the existing `confirm` two-step (show draft → apply).

```
memcarry refine <atomId>                          # DRAFT: show current claim + how it'd change (dry)
memcarry refine <atomId> --do "<new action>" --because "<dated evidence>" --apply
```
- **Draft (no --apply):** prints current `WHEN→DO→BECAUSE`, the proposed change, and the resulting diff.
  Writes nothing. `{ id, current, proposed, willWrite:false }`.
- **Apply (--apply):** runs `refineLesson`, `writeAtom` (overwrite by id), prints `{ confirmed:true, id,
  path, provenance:"human-confirmed", last_refined }`.
- **Guards:** atom not found / not a global lesson / no change given → clear error, exit non-zero, no write.
- Reads atoms from disk. Never throws on malformed → error object, exit 1.

## C2 — Model mid-turn proposal (FR7, hook+CLI — NOT MCP)
When the user says in conversation that a recalled lesson is wrong/incomplete:
- The model runs `memcarry refine <atomId>` (DRAFT, no `--apply`) → gets the proposed diff → shows it
  inline as `<memcarry-refine>` (C4). **No write yet.**
- Only after the USER confirms ("yes") does the model run `memcarry refine <atomId> --do … --because … --apply`.
- **The confirm gate is the user's word in conversation** — the apply call only happens after it. The model
  is instructed never to pass `--apply` without explicit user confirmation. (Anti-loop: authority = the
  user, never the model's own assertion.) This is the same shell-out pattern recall/resume/drift use.

## C3 — End-skill safety net (FR8)
At session end, scan: which `global` lessons did recall surface this session that were NOT refined?
- For each, the End flow asks: "Recalled '<claim>' — did you learn anything that refines it?"
- Yes → routes through the same `refine` draft→confirm. No → nothing written.
- Zero recalled-global atoms → silent (no prompt).

## C4 — Inline diff (FR10)
The proposed change surfaces as `additionalContext`:
```
<memcarry-refine atom="lsn_x">
WAS:  WHEN editing a .patch → DO never hand-edit BECAUSE broke build #62 (2026-06-04)
NOW:  WHEN editing a .patch → DO ok to hand-edit IF you regen the hash after
      BECAUSE broke build #62 (2026-06-04); refined: hash-regen works (Du-tracking 2026-06-15)
Confirm? (yes / edit / no)
```

## Unchanged (regression guard)
- `writeAtom`, `confirm`, `recall`, `resume`, `capture` signatures unchanged.
- `packages/mcp` NOT touched (MCP dropped from scope — unregistered stub).
- Existing tests stay green; old atoms (no `last_refined`) parse fine.
