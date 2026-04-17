# skills-examples/

Example skills demonstrating how to build domain-specific workflows for KAI.

**These are NOT active skills.** KAI's skill discovery only scans `skills/` — files in
`skills-examples/` are never indexed, auto-loaded, or triggerable.

## How to use

1. Copy the relevant example into `skills/YourSkillName/`
2. Replace `[Your Company]`, `[Your Product]`, `[Your Industry]` with your context
3. Rebuild: `bun run ~/.claude/hooks/handlers/BuildSettings.ts`

## Available Examples

| Skill | What it does |
|-------|-------------|
| `CompetitiveIntel/` | Competitive intelligence tracking for your product vs. competitors |
| `StandardsTracker/` | Industry standards monitoring and compliance gap tracking |
| `NPITracker/` | New Product Introduction risk tracking and gate checklists |

## Customization

These examples were built for an Engineering Manager in the wireless networking industry.
The patterns work for any domain — replace the industry-specific terminology with your own.
