import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { clearSkillCardCache, loadSkillCards, loadSkillCardsCached, recommendSkills } from '../hooks/SkillDiscoveryRecommender.hook';

function makeSkill(root: string, name: string, description: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---
name: ${name}
description: ${description}
---

# ${name}
`);
}

describe('SkillDiscoveryRecommender', () => {
  test('loads skill trigger phrases from SKILL.md frontmatter', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-recommend-'));
    makeSkill(root, 'RedTeam', 'Adversarial analysis. USE WHEN red team, critique, stress test.');

    const cards = loadSkillCards(root);

    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe('RedTeam');
    expect(cards[0].triggers).toContain('stress test');
  });

  test('reuses cached skill cards until SKILL.md mtime or size changes', () => {
    const root = mkdtempSync(join(tmpdir(), 'skill-recommend-'));
    const cache = join(root, 'cache.json');
    makeSkill(root, 'RedTeam', 'Adversarial analysis. USE WHEN red team, critique, stress test.');

    const first = loadSkillCardsCached(root, cache);
    writeFileSync(join(root, 'RedTeam', 'SKILL.md'), `---
name: RedTeam
description: stale if cache is incorrectly reused
---

# RedTeam
`);
    const second = loadSkillCardsCached(root, cache);

    expect(first[0].triggers).toContain('stress test');
    expect(second[0].description).toContain('stale if cache is incorrectly reused');
    clearSkillCardCache(cache);
  });

  test('recommends a close matching skill', () => {
    const cards = [
      { name: 'RedTeam', description: '', triggers: ['red team', 'critique', 'stress test'] },
      { name: 'Research', description: '', triggers: ['research', 'find information'] },
    ];

    const [rec] = recommendSkills('stress test this roadmap before we commit to it', cards);

    expect(rec.skill).toBe('RedTeam');
    expect(rec.trigger).toBe('stress test');
  });

  test('does not recommend a skill already explicitly invoked', () => {
    const cards = [{ name: 'Research', description: '', triggers: ['research'] }];

    expect(recommendSkills('/Research this topic', cards)).toEqual([]);
  });
});
