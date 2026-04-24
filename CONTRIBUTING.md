# Contributing to KAI

Thanks for your interest in contributing to KAI (Kaizen AI).

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/kai.git`
3. Create a branch: `git checkout -b my-feature`
4. Make your changes
5. Run tests: `bun test`
6. Commit and push
7. Open a pull request

## Development Setup

KAI requires [Bun](https://bun.sh) as its runtime. Install it first:

```bash
curl -fsSL https://bun.sh/install | bash
```

No `bun install` step is needed — KAI uses only Bun built-ins and has no external dependencies.

```bash
cd kai
bun test   # verify everything works
```

## File Categories

KAI uses a three-category file model:

| Category | Editable? | Examples |
|----------|-----------|---------|
| **System** | PRs welcome | `hooks/*.ts`, `skills/`, `PAI/Algorithm/` |
| **User** | Never committed | `PAI/USER/`, `config/identity.jsonc`, `.env` |
| **Runtime** | Auto-generated | `settings.json`, `CLAUDE.md`, `MEMORY/` |

Contributions should only touch **System** files. User and Runtime files are gitignored.

## What to Contribute

- Bug fixes in hooks or tools
- New skills (add to `skills/`)
- Algorithm improvements
- Test coverage
- Documentation

## Guidelines

- Run `bun test` before submitting — all tests must pass
- Keep hooks fast (< 200ms for blocking hooks, < 30s for async)
- Skills should be self-contained in their own directory
- Use TypeScript for all new code
- No personal or company-specific content in system files

## Reporting Issues

Open an issue at [github.com/kai-cli/kai/issues](https://github.com/kai-cli/kai/issues) with:
- What you expected
- What happened
- Steps to reproduce
- Your environment (OS, Bun version, Claude Code version)
