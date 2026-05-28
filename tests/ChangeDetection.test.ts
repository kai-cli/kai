import { describe, test, expect } from 'bun:test';
import {
  categorizeChange,
  isSignificantChange,
  shouldDocumentChanges,
  hashChanges,
  determineSignificance,
  inferChangeType,
  type FileChange,
  type ChangeCategory,
} from '../hooks/lib/change-detection';

describe('change-detection.ts', () => {
  describe('categorizeChange', () => {
    test('categorizes skill files', () => {
      expect(categorizeChange('skills/DevTeam/SKILL.md')).toBe('skill');
      expect(categorizeChange('skills/Research/Tools/search.ts')).toBe('skill');
    });

    test('categorizes workflow files', () => {
      expect(categorizeChange('skills/DevTeam/Workflows/Fix.md')).toBe('workflow');
      expect(categorizeChange('skills/Research/Workflows/Deep.md')).toBe('workflow');
    });

    test('categorizes hook files', () => {
      expect(categorizeChange('hooks/StartupGreeting.hook.ts')).toBe('hook');
      expect(categorizeChange('hooks/lib/paths.ts')).toBe('hook');
    });

    test('categorizes config files', () => {
      expect(categorizeChange('settings.json')).toBe('config');
    });

    test('categorizes documentation files', () => {
      expect(categorizeChange('MEMORY/PAISYSTEMUPDATES/v5.0.md')).toBe('documentation');
      expect(categorizeChange('README.md')).toBe('documentation');
    });

    test('categorizes memory system files', () => {
      expect(categorizeChange('MEMORY/KNOWLEDGE/test.md')).toBe('memory-system');
      expect(categorizeChange('MEMORY/SECURITY/events.jsonl')).toBe('memory-system');
    });

    test('excludes WORK directory', () => {
      expect(categorizeChange('MEMORY/WORK/task/PRD.md')).toBe(null);
      expect(categorizeChange('MEMORY/WORK/investigation/notes.md')).toBe(null);
    });

    test('excludes LEARNING directory', () => {
      expect(categorizeChange('MEMORY/LEARNING/2024-01/lesson.md')).toBe(null);
    });

    test('excludes STATE directory', () => {
      expect(categorizeChange('MEMORY/STATE/session.json')).toBe(null);
    });

    test('excludes Plans directory', () => {
      expect(categorizeChange('Plans/project-plan.md')).toBe(null);
    });

    test('excludes private skills (prefixed with _)', () => {
      expect(categorizeChange('skills/_Private/SKILL.md')).toBe(null);
      expect(categorizeChange('skills/_Testing/Tools/test.ts')).toBe(null);
    });

    test('categorizes core system files', () => {
      expect(categorizeChange('skills/PAI/PAISYSTEMARCHITECTURE.md')).toBe('core-system');
      expect(categorizeChange('skills/PAI/THEHOOKSYSTEM.md')).toBe('core-system');
    });
  });

  describe('isSignificantChange', () => {
    test('returns false for empty changes', () => {
      expect(isSignificantChange([])).toBe(false);
    });

    test('returns false when no system changes', () => {
      const changes: FileChange[] = [
        { tool: 'Write', path: 'MEMORY/WORK/task/notes.md', category: null, isPhilosophical: false, isStructural: false },
      ];
      expect(isSignificantChange(changes)).toBe(false);
    });

    test('returns true for philosophical changes', () => {
      const changes: FileChange[] = [
        { tool: 'Write', path: 'PAI/IDENTITY.md', category: 'documentation', isPhilosophical: true, isStructural: false },
      ];
      expect(isSignificantChange(changes)).toBe(true);
    });

    test('returns true for structural changes', () => {
      const changes: FileChange[] = [
        { tool: 'Write', path: 'skills/DevTeam/SKILL.md', category: 'skill', isPhilosophical: false, isStructural: true },
      ];
      expect(isSignificantChange(changes)).toBe(true);
    });

    test('returns true for multiple files in same domain', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'skills/DevTeam/SKILL.md', category: 'skill', isPhilosophical: false, isStructural: false },
        { tool: 'Edit', path: 'skills/DevTeam/Tools/fix.ts', category: 'skill', isPhilosophical: false, isStructural: false },
      ];
      expect(isSignificantChange(changes)).toBe(true);
    });

    test('returns true for skill changes', () => {
      const changes: FileChange[] = [
        { tool: 'Write', path: 'skills/Research/SKILL.md', category: 'skill', isPhilosophical: false, isStructural: false },
      ];
      expect(isSignificantChange(changes)).toBe(true);
    });

    test('returns true for hook changes', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'hooks/StartupGreeting.hook.ts', category: 'hook', isPhilosophical: false, isStructural: false },
      ];
      expect(isSignificantChange(changes)).toBe(true);
    });
  });

  describe('shouldDocumentChanges', () => {
    test('returns false for empty changes', () => {
      expect(shouldDocumentChanges([])).toBe(false);
    });

    test('returns true for philosophical changes', () => {
      const changes: FileChange[] = [
        { tool: 'Write', path: 'PAI/IDENTITY.md', category: 'documentation', isPhilosophical: true, isStructural: false },
      ];
      expect(shouldDocumentChanges(changes)).toBe(true);
    });

    test('returns true for structural changes', () => {
      const changes: FileChange[] = [
        { tool: 'Write', path: 'skills/DevTeam/SKILL.md', category: 'skill', isPhilosophical: false, isStructural: true },
      ];
      expect(shouldDocumentChanges(changes)).toBe(true);
    });

    test('returns true for any skill change', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'skills/Research/Tools/search.ts', category: 'skill', isPhilosophical: false, isStructural: false },
      ];
      expect(shouldDocumentChanges(changes)).toBe(true);
    });

    test('returns true for hook changes', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'hooks/StartupGreeting.hook.ts', category: 'hook', isPhilosophical: false, isStructural: false },
      ];
      expect(shouldDocumentChanges(changes)).toBe(true);
    });

    test('returns true for config changes', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'settings.json', category: 'config', isPhilosophical: false, isStructural: false },
      ];
      expect(shouldDocumentChanges(changes)).toBe(true);
    });

    test('returns true for 2+ file changes', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'doc1.md', category: 'documentation', isPhilosophical: false, isStructural: false },
        { tool: 'Edit', path: 'doc2.md', category: 'documentation', isPhilosophical: false, isStructural: false },
      ];
      expect(shouldDocumentChanges(changes)).toBe(true);
    });

    test('returns true for new file creation', () => {
      const changes: FileChange[] = [
        { tool: 'Write', path: 'skills/NewSkill/SKILL.md', category: 'skill', isPhilosophical: false, isStructural: false },
      ];
      expect(shouldDocumentChanges(changes)).toBe(true);
    });
  });

  describe('hashChanges', () => {
    test('generates consistent hash for same changes', () => {
      const changes: FileChange[] = [
        { tool: 'Write', path: 'test.md', category: 'documentation', isPhilosophical: false, isStructural: false },
      ];
      const hash1 = hashChanges(changes);
      const hash2 = hashChanges(changes);
      expect(hash1).toBe(hash2);
    });

    test('generates different hash for different changes', () => {
      const changes1: FileChange[] = [
        { tool: 'Write', path: 'test1.md', category: 'documentation', isPhilosophical: false, isStructural: false },
      ];
      const changes2: FileChange[] = [
        { tool: 'Write', path: 'test2.md', category: 'documentation', isPhilosophical: false, isStructural: false },
      ];
      const hash1 = hashChanges(changes1);
      const hash2 = hashChanges(changes2);
      expect(hash1).not.toBe(hash2);
    });

    test('sorts changes before hashing', () => {
      const changes1: FileChange[] = [
        { tool: 'Write', path: 'a.md', category: 'documentation', isPhilosophical: false, isStructural: false },
        { tool: 'Write', path: 'b.md', category: 'documentation', isPhilosophical: false, isStructural: false },
      ];
      const changes2: FileChange[] = [
        { tool: 'Write', path: 'b.md', category: 'documentation', isPhilosophical: false, isStructural: false },
        { tool: 'Write', path: 'a.md', category: 'documentation', isPhilosophical: false, isStructural: false },
      ];
      expect(hashChanges(changes1)).toBe(hashChanges(changes2));
    });

    test('handles empty changes', () => {
      const hash = hashChanges([]);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });
  });

  describe('determineSignificance', () => {
    test('returns critical for structural + philosophical + 5+ files', () => {
      const changes: FileChange[] = Array(5).fill(null).map((_, i) => ({
        tool: 'Edit' as const,
        path: `file${i}.md`,
        category: 'skill' as ChangeCategory,
        isPhilosophical: true,
        isStructural: true,
      }));
      expect(determineSignificance(changes)).toBe('critical');
    });

    test('returns major for new structural files', () => {
      const changes: FileChange[] = [
        { tool: 'Write', path: 'skills/New/SKILL.md', category: 'skill', isPhilosophical: false, isStructural: true },
      ];
      expect(determineSignificance(changes)).toBe('major');
    });

    test('returns major for core-system changes', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'PAI/SYSTEM.md', category: 'core-system', isPhilosophical: false, isStructural: false },
      ];
      expect(determineSignificance(changes)).toBe('major');
    });

    test('returns moderate for multi-file updates', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'file1.md', category: 'documentation', isPhilosophical: false, isStructural: false },
        { tool: 'Edit', path: 'file2.md', category: 'documentation', isPhilosophical: false, isStructural: false },
        { tool: 'Edit', path: 'file3.md', category: 'documentation', isPhilosophical: false, isStructural: false },
      ];
      expect(determineSignificance(changes)).toBe('moderate');
    });

    test('returns minor for single file non-structural change', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'file.md', category: 'documentation', isPhilosophical: false, isStructural: false },
      ];
      expect(determineSignificance(changes)).toBe('minor');
    });

    test('returns minor for single documentation change', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'docs/readme.md', category: 'documentation', isPhilosophical: false, isStructural: false },
      ];
      expect(determineSignificance(changes)).toBe('minor');
    });
  });

  describe('inferChangeType', () => {
    test('returns multi_area for 3+ categories', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'skill.md', category: 'skill', isPhilosophical: false, isStructural: false },
        { tool: 'Edit', path: 'hook.ts', category: 'hook', isPhilosophical: false, isStructural: false },
        { tool: 'Edit', path: 'settings.json', category: 'config', isPhilosophical: false, isStructural: false },
      ];
      expect(inferChangeType(changes)).toBe('multi_area');
    });

    test('returns skill_update for skill changes', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'skills/DevTeam/Tools/fix.ts', category: 'skill', isPhilosophical: false, isStructural: false },
      ];
      expect(inferChangeType(changes)).toBe('skill_update');
    });

    test('returns hook_update for hook changes', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'hooks/StartupGreeting.hook.ts', category: 'hook', isPhilosophical: false, isStructural: false },
      ];
      expect(inferChangeType(changes)).toBe('hook_update');
    });

    test('returns workflow_update for workflow changes', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'skills/DevTeam/Workflows/Fix.md', category: 'workflow', isPhilosophical: false, isStructural: false },
      ];
      expect(inferChangeType(changes)).toBe('workflow_update');
    });

    test('returns config_update for config changes', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'settings.json', category: 'config', isPhilosophical: false, isStructural: false },
      ];
      expect(inferChangeType(changes)).toBe('config_update');
    });

    test('returns structure_change for structural skill changes', () => {
      const changes: FileChange[] = [
        { tool: 'Write', path: 'skills/New/SKILL.md', category: 'skill', isPhilosophical: false, isStructural: true },
      ];
      expect(inferChangeType(changes)).toBe('structure_change');
    });

    test('returns doc_update for documentation changes', () => {
      const changes: FileChange[] = [
        { tool: 'Edit', path: 'README.md', category: 'documentation', isPhilosophical: false, isStructural: false },
      ];
      expect(inferChangeType(changes)).toBe('doc_update');
    });
  });
});
