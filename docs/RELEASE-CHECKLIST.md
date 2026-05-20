# KAI Release Checklist

Run through this every time you sync pai-config → KAI for a new version.

## Pre-Sync (in pai-config)

- [ ] `VERSION` file updated
- [ ] `manifest.json` version, counts (skills/hooks/agents), inventories current
- [ ] `config/preferences.jsonc` → `pai.version` matches
- [ ] `docs/planning/NEXT-STEPS.md` → new version section with shipped date
- [ ] New plan file added to `EXCLUDE_PATHS` in `scripts/sync-to-kai.sh`
- [ ] Any new personal/History directories added to sync exclusions

## Sync Execution

- [ ] `bash scripts/sync-to-kai.sh --commit`
- [ ] Review output: PII scrub count, brand transform count, verify-release result

## Post-Sync Verification (in kai)

### Versioning
- [ ] `manifest.json` → version, productName ("KAI"), counts match filesystem
- [ ] `README.md` header → `# KAI X.Y.Z`
- [ ] `CHANGELOG.md` → new version section at top with date
- [ ] `config/preferences.jsonc` → `pai.version` and `pai.repoUrl` correct

### Counts & Inventories
- [ ] `manifest.json` skills count = `find skills -name "SKILL.md" | wc -l`
- [ ] `manifest.json` hooks count = `find hooks -name "*.hook.ts" | wc -l`
- [ ] `manifest.json` hookInventory lists all hooks alphabetically
- [ ] `manifest.json` skillInventory lists all skills alphabetically
- [ ] `CHANGELOG.md` stats match manifest

### PII & Brand
- [ ] `grep -wrl "jnap\|bbfdm\|obuspa\|velop\|YourCompany\|yourcompany"` → zero hits (excl verify-release)
- [ ] `grep -rl "YourName\|YourLastName\|username\|@yourcompany"` → zero word-boundary hits
- [ ] `grep -rl "pai-config"` → only in verify-release.sh, pre-commit, pre-push (detection rules)
- [ ] `grep -rl "danielmiessler/PAI"` → zero hits (all should be kai-cli/kai)
- [ ] `grep -rl "YourNameYourLastName"` → zero (scrub artifact)
- [ ] No `projects/*/memory/*.md` tracked (`git ls-files -- projects/`)
- [ ] No personal project paths (`~/Projects/WARP`, `~/Projects/TR-069`, etc.)

### Stale Content
- [ ] No `skills/PAIUpgrade/` (should only be `skills/Utilities/KAIUpgrade/`)
- [ ] No STAGING archive files with personal content
- [ ] `docs/planning/NEXT-STEPS.md` → no private/public repo description leak
- [ ] `board-config.json` → generic (no personal project list)

### Tests & Verification
- [ ] `bun test` → all pass, zero failures
- [ ] `bash scripts/verify-release.sh` → 16/16 pass, RELEASE VERIFICATION PASSED
- [ ] Domain-specific test data uses generic terms (not jnap/bbfdm/etc.)

## Push

- [ ] `git push origin main` to kai-cli/kai
- [ ] Verify GitHub Actions CI passes (if enabled)
- [ ] Tag release if major version: `git tag v5.X.0 && git push --tags`

## Updating This Checklist

If you find a new issue class during sync (new PII pattern, new stale content type),
add it to the appropriate section above so it's caught next time.
