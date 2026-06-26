# Codex Cross-Validation

Independent second-opinion validation for PAI/KAI using **Codex CLI (OpenAI gpt-5.5)**
— a different model family from Claude, so it catches errors Claude misses rather
than just echoing them.

## Files (canonical source — live copies symlink here)

| File | Live location (symlink) | Purpose |
|------|-------------------------|---------|
| `codex-validate` | `~/.local/bin/codex-validate` | Wrapper CLI: design / files / diff review |
| `review.config.toml` | `~/.codex/review.config.toml` | Pinned profile: `gpt-5.5`, reasoning effort `high` |
| `review-schema.json` | `~/.codex/review-schema.json` | Structured verdict schema (`verdict`/`summary`/`findings`) |

These three live paths are symlinks into this directory, so the repo is the single
source of truth — edit here, the live tool updates automatically.

## Deploy on a new machine

```bash
REPO="$HOME/Projects/kai"          # or wherever this repo is cloned
ln -sf "$REPO/PAI/Codex/codex-validate"     ~/.local/bin/codex-validate
ln -sf "$REPO/PAI/Codex/review.config.toml" ~/.codex/review.config.toml
ln -sf "$REPO/PAI/Codex/review-schema.json" ~/.codex/review-schema.json
chmod +x "$REPO/PAI/Codex/codex-validate"
```

Requires Codex CLI installed (`~/.local/bin/codex`, standalone install) and
authenticated (`~/.codex/auth.json`).

## Usage

```bash
codex-validate "<design / claim / question>"   # design/claim review
codex-validate -f path1 [path2 ...]             # review specific files
codex-validate diff                             # uncommitted changes
codex-validate diff --base main                 # branch vs base
codex-validate diff --commit <sha>              # one commit
codex-validate --json <any of the above>        # structured JSON verdict
```

**Independence hygiene:** pass Codex the artifact + question only — never your own
conclusion ("confirm this is right"), which biases it toward agreement. The wrapper
already injects "do not assume it is correct."

## Codex CLI gotchas baked into the wrapper (codex-cli 0.141.0)

- `--ignore-user-config` isolates from user plugins/MCP/hooks but **silently drops**
  the profile's `model_reasoning_effort` (model survives, effort → none). The wrapper
  re-pins both via `-c model=gpt-5.5 -c model_reasoning_effort=high`.
- The native `codex exec review` subcommand **accepts but ignores** `--output-schema`
  (always prose). For a structured diff verdict the wrapper pipes the `git diff` text
  through the schema-capable `exec` path instead.
- `review --uncommitted/--base/--commit` cannot take a trailing prompt; exec-level
  flags (`-p`, `-s`, `--ignore-user-config`) must precede the `review` subcommand.

## Reuse in KAI

This directory is self-contained and machine-agnostic (no hardcoded user paths in the
canonical files except the wrapper's `CODEX`/`SCHEMA` defaults, which honor
`$HOME` and the `CODEX_BIN` env override). To port into the public KAI fork, copy
`PAI/Codex/` and ship the deploy snippet above.
