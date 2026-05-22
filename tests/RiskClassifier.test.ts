/**
 * RiskClassifier.test.ts — Tests for hooks/lib/risk-classifier.ts
 */

import { describe, test, expect } from 'bun:test';
import { classifyCommand } from '../hooks/lib/risk-classifier';

describe('read-only classification', () => {
  test('ls -la is read-only', () => {
    const r = classifyCommand('ls -la');
    expect(r.is_read_only).toBe(true);
    expect(r.is_risky).toBe(false);
    expect(r.is_destructive).toBe(false);
  });

  test('cat file.txt is read-only', () => {
    const r = classifyCommand('cat /tmp/file.txt');
    expect(r.is_read_only).toBe(true);
  });

  test('grep pattern file is read-only', () => {
    const r = classifyCommand('grep -rn "pattern" .');
    expect(r.is_read_only).toBe(true);
  });

  test('git status is read-only', () => {
    const r = classifyCommand('git status');
    expect(r.is_read_only).toBe(true);
    expect(r.modifies_git).toBe(false);
  });

  test('git diff is read-only', () => {
    const r = classifyCommand('git diff HEAD~1');
    expect(r.is_read_only).toBe(true);
  });

  test('git show is read-only', () => {
    const r = classifyCommand('git show abc123');
    expect(r.is_read_only).toBe(true);
  });

  test('curl GET is read-only', () => {
    const r = classifyCommand('curl https://example.com/api');
    expect(r.is_read_only).toBe(true);
    expect(r.is_risky).toBe(false);
  });

  test('wc -l is read-only', () => {
    const r = classifyCommand('wc -l file.txt');
    expect(r.is_read_only).toBe(true);
  });

  test('find . -name is read-only', () => {
    const r = classifyCommand('find . -name "*.ts"');
    expect(r.is_read_only).toBe(true);
  });
});

describe('risky classification', () => {
  test('rm file.txt is risky (not destructive)', () => {
    const r = classifyCommand('rm file.txt');
    expect(r.is_risky).toBe(true);
    expect(r.is_destructive).toBe(false);
  });

  test('kill -9 is risky', () => {
    const r = classifyCommand('kill -9 1234');
    expect(r.is_risky).toBe(true);
  });

  test('git push (no --force) is risky', () => {
    const r = classifyCommand('git push origin main');
    expect(r.is_risky).toBe(true);
    expect(r.is_destructive).toBe(false);
    expect(r.modifies_git).toBe(true);
  });

  test('curl POST is risky', () => {
    const r = classifyCommand('curl -X POST https://api.example.com/data');
    expect(r.is_risky).toBe(true);
    expect(r.is_read_only).toBe(false);
  });

  test('curl DELETE is risky', () => {
    const r = classifyCommand('curl -X DELETE https://api.example.com/resource/1');
    expect(r.is_risky).toBe(true);
  });
});

describe('destructive classification', () => {
  test('rm -rf /tmp/foo is destructive', () => {
    const r = classifyCommand('rm -rf /tmp/foo');
    expect(r.is_destructive).toBe(true);
    expect(r.is_risky).toBe(true);
    expect(r.is_read_only).toBe(false);
  });

  test('rm -fr is destructive', () => {
    const r = classifyCommand('rm -fr /path');
    expect(r.is_destructive).toBe(true);
  });

  test('git push --force is destructive', () => {
    const r = classifyCommand('git push --force origin main');
    expect(r.is_destructive).toBe(true);
    expect(r.modifies_git).toBe(true);
  });

  test('git push -f is destructive', () => {
    const r = classifyCommand('git push -f origin main');
    expect(r.is_destructive).toBe(true);
  });

  test('git reset --hard is destructive', () => {
    const r = classifyCommand('git reset --hard HEAD~1');
    expect(r.is_destructive).toBe(true);
    expect(r.modifies_git).toBe(true);
  });

  test('git clean -fd is destructive', () => {
    const r = classifyCommand('git clean -fd');
    expect(r.is_destructive).toBe(true);
  });

  test('DROP TABLE is destructive', () => {
    const r = classifyCommand('psql -c "DROP TABLE users"');
    expect(r.is_destructive).toBe(true);
  });

  test('TRUNCATE is destructive', () => {
    const r = classifyCommand('psql -c "TRUNCATE events"');
    expect(r.is_destructive).toBe(true);
  });

  test('redirect to real file is destructive', () => {
    const r = classifyCommand('echo "test" > ~/.claude/settings.json');
    expect(r.is_destructive).toBe(true);
    expect(r.is_read_only).toBe(false);
  });

  test('redirect to /dev/null is NOT destructive', () => {
    const r = classifyCommand('echo "test" > /dev/null');
    expect(r.is_destructive).toBe(false);
    // echo is read-only and /dev/null redirect doesn't change that
    expect(r.is_risky).toBe(false);
  });
});

describe('pager classification', () => {
  test('less is a pager', () => {
    const r = classifyCommand('less file.txt');
    expect(r.uses_pager).toBe(true);
  });

  test('man git is a pager', () => {
    const r = classifyCommand('man git');
    expect(r.uses_pager).toBe(true);
  });

  test('git log without --no-pager uses pager', () => {
    const r = classifyCommand('git log --oneline');
    expect(r.uses_pager).toBe(true);
  });

  test('git log --no-pager does NOT use pager', () => {
    const r = classifyCommand('git --no-pager log');
    expect(r.uses_pager).toBe(false);
  });
});

describe('git modification tracking', () => {
  test('git commit modifies git', () => {
    const r = classifyCommand('git commit -m "message"');
    expect(r.modifies_git).toBe(true);
    expect(r.is_risky).toBe(true);
  });

  test('git rebase modifies git', () => {
    const r = classifyCommand('git rebase main');
    expect(r.modifies_git).toBe(true);
  });

  test('git merge modifies git', () => {
    const r = classifyCommand('git merge feature-branch');
    expect(r.modifies_git).toBe(true);
  });

  test('git tag modifies git', () => {
    const r = classifyCommand('git tag v1.0.0');
    expect(r.modifies_git).toBe(true);
  });

  test('git log does NOT modify git', () => {
    const r = classifyCommand('git log --oneline -10');
    expect(r.modifies_git).toBe(false);
  });

  test('git branch (list) does NOT modify git', () => {
    const r = classifyCommand('git branch -a');
    expect(r.modifies_git).toBe(false);
  });
});

describe('edge cases', () => {
  test('command field is set to input', () => {
    const r = classifyCommand('ls -la');
    expect(r.command).toBe('ls -la');
  });

  test('empty command returns all false', () => {
    const r = classifyCommand('');
    expect(r.is_read_only).toBe(false);
    expect(r.is_risky).toBe(false);
    expect(r.is_destructive).toBe(false);
    expect(r.uses_pager).toBe(false);
    expect(r.modifies_git).toBe(false);
  });

  test('unknown command returns all false', () => {
    const r = classifyCommand('mycustomtool --flag arg');
    expect(r.is_read_only).toBe(false);
    expect(r.is_destructive).toBe(false);
  });
});
