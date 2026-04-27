# KAI Releases

## Current Release

### v5.0.0 — Initial Public Release (2026-04)

First public release of KAI, forked from Daniel Miessler's PAI and hardened for deployment.

- 41 skill modules across 12 categories
- 35 lifecycle hooks with stderr wrapper + async flags
- 18 named agents (Architect, Engineer, 5 researchers, etc.)
- Algorithm v3.12.0 with ISC quality gates
- Interactive setup wizard with archetype selection
- Domain-based config (7 JSONC files merged into settings.json)
- SecretScanner, GitHubWriteGuard, SecurityValidator
- AWS Bedrock support (optional)
- curl-pipe installer (`get-kai.sh`)

## Installation

```bash
# Clone and install
git clone https://github.com/kai-cli/kai.git ~/kai
bash ~/kai/install.sh
```

Or use the remote installer:
```bash
curl -fsSL https://raw.githubusercontent.com/kai-cli/kai/main/get-kai.sh | bash
```

See the [main README](../README.md) for full documentation.

## Ancestry

KAI is a fork of [Daniel Miessler's PAI](https://danielmiessler.com) (v4.0.3). See [WHATS-DIFFERENT.md](../WHATS-DIFFERENT.md) for a detailed comparison.
