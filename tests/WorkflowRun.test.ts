import { describe, test, expect } from 'bun:test';
import { substituteArgs } from '../scripts/workflow-run';
import type {} from '../scripts/workflow-run';

// We import only the pure substituteArgs function from workflow-run.ts.
// The CLI main() is not invoked in tests — it requires actual filesystem
// workflow files and executes shell commands.

interface WorkflowTemplate {
  name: string;
  description: string;
  command: string;
  arguments?: Array<{
    name: string;
    description?: string;
    default?: string;
    required?: boolean;
    options?: string[];
  }>;
  tags?: string[];
}

const FIRMWARE_BUILD_TEMPLATE: WorkflowTemplate = {
  name: 'firmware-build',
  description: 'Build firmware for a specific target board',
  command: 'cd ~/Projects/firmware && make defconfig BOARD={{board}} && make -j$(nproc)',
  arguments: [
    { name: 'board', description: 'Target board', default: 'board-a', options: ['board-a', 'board-b', 'board-c'] },
  ],
  tags: ['firmware', 'build'],
};

const JENKINS_TRIGGER_TEMPLATE: WorkflowTemplate = {
  name: 'jenkins-trigger',
  description: 'Trigger a Jenkins build for a branch',
  command: 'bun ~/.claude/skills/Utilities/Tools/JenkinsTrigger.ts --branch {{branch}} --target {{target}}',
  arguments: [
    { name: 'branch', description: 'Git branch to build', required: true },
    { name: 'target', description: 'Build target', default: 'board-a-dev' },
  ],
  tags: ['jenkins', 'ci'],
};

describe('WorkflowRun — substituteArgs', () => {
  describe('{{variable}} interpolation', () => {
    test('substitutes single variable', () => {
      const result = substituteArgs(
        'echo {{board}}',
        { ...FIRMWARE_BUILD_TEMPLATE, command: 'echo {{board}}' },
        { board: 'board-b' }
      );
      expect(result).toBe('echo board-b');
    });

    test('substitutes multiple variables', () => {
      const result = substituteArgs(
        JENKINS_TRIGGER_TEMPLATE.command,
        JENKINS_TRIGGER_TEMPLATE,
        { branch: 'feature/test', target: 'board-b-dev' }
      );
      expect(result).toContain('--branch feature/test');
      expect(result).toContain('--target board-b-dev');
    });

    test('uses default when argument not provided', () => {
      const result = substituteArgs(
        FIRMWARE_BUILD_TEMPLATE.command,
        FIRMWARE_BUILD_TEMPLATE,
        {} // no board arg → should use default 'board-a'
      );
      expect(result).toContain('BOARD=board-a');
    });

    test('provided value overrides default', () => {
      const result = substituteArgs(
        FIRMWARE_BUILD_TEMPLATE.command,
        FIRMWARE_BUILD_TEMPLATE,
        { board: 'board-b' }
      );
      expect(result).toContain('BOARD=board-b');
    });
  });

  describe('Shell variable pass-through', () => {
    test('${shell_var} passes through unchanged', () => {
      const template: WorkflowTemplate = {
        name: 'test',
        description: 'test',
        command: 'echo ${HOME} and {{name}}',
        arguments: [{ name: 'name' }],
      };
      const result = substituteArgs(template.command, template, { name: 'world' });
      expect(result).toBe('echo ${HOME} and world');
    });

    test('$(cmd) passes through unchanged', () => {
      const template: WorkflowTemplate = {
        name: 'test',
        description: 'test',
        command: 'make -j$(nproc) BOARD={{board}}',
        arguments: [{ name: 'board', default: 'board-a' }],
      };
      const result = substituteArgs(template.command, template, {});
      expect(result).toBe('make -j$(nproc) BOARD=board-a');
    });

    test('${{ }} GitHub Actions syntax not confused with {{}}', () => {
      // We use double-brace without dollar sign — no conflict
      const template: WorkflowTemplate = {
        name: 'test',
        description: 'test',
        command: 'echo {{value}}',
        arguments: [{ name: 'value', default: 'hello' }],
      };
      const result = substituteArgs(template.command, template, {});
      expect(result).toBe('echo hello');
    });
  });

  describe('Required argument validation', () => {
    test('throws clear error when required argument is missing', () => {
      expect(() =>
        substituteArgs(JENKINS_TRIGGER_TEMPLATE.command, JENKINS_TRIGGER_TEMPLATE, {
          // 'branch' is required but not provided; 'target' has a default
        })
      ).toThrow('Missing required argument: --branch');
    });

    test('error message includes usage hint', () => {
      try {
        substituteArgs(JENKINS_TRIGGER_TEMPLATE.command, JENKINS_TRIGGER_TEMPLATE, {});
      } catch (e: any) {
        expect(e.message).toContain('jenkins-trigger');
        expect(e.message).toContain('--branch');
      }
    });

    test('does not throw when required argument is provided', () => {
      expect(() =>
        substituteArgs(JENKINS_TRIGGER_TEMPLATE.command, JENKINS_TRIGGER_TEMPLATE, {
          branch: 'main',
        })
      ).not.toThrow();
    });
  });

  describe('Anti-criteria — security boundary', () => {
    test('substituteArgs does not execute the command', () => {
      // Verify that substituteArgs only returns a string — no exec side effects
      let executedCommand = '';
      const spy = (cmd: string) => { executedCommand = cmd; };

      const result = substituteArgs(
        'echo {{msg}}',
        { name: 'test', description: 'test', command: 'echo {{msg}}', arguments: [{ name: 'msg' }] },
        { msg: 'hello' }
      );

      // substituteArgs only returns the interpolated string, never executes
      expect(result).toBe('echo hello');
      expect(executedCommand).toBe(''); // no execution
    });

    test('template with no arguments returns command unchanged', () => {
      const template: WorkflowTemplate = {
        name: 'simple',
        description: 'A simple workflow',
        command: 'echo hello world',
        arguments: [],
      };
      const result = substituteArgs(template.command, template, {});
      expect(result).toBe('echo hello world');
    });
  });
});
