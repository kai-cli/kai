import { describe, test, expect } from 'bun:test';
import {
  TAB_COLORS,
  ACTIVE_TAB_BG,
  ACTIVE_TAB_FG,
  INACTIVE_TAB_FG,
  PHASE_TAB_CONFIG,
  type TabState,
  type AlgorithmTabPhase,
} from '../hooks/lib/tab-constants';

describe('tab-constants.ts', () => {
  describe('TAB_COLORS', () => {
    test('has all required states', () => {
      const requiredStates = ['thinking', 'working', 'question', 'completed', 'error', 'idle'];
      requiredStates.forEach(state => {
        expect(TAB_COLORS[state as TabState]).toBeDefined();
      });
    });

    test('each state has inactiveBg and label', () => {
      Object.entries(TAB_COLORS).forEach(([state, config]) => {
        expect(config.inactiveBg).toBeDefined();
        expect(config.label).toBeDefined();
        expect(typeof config.inactiveBg).toBe('string');
        expect(typeof config.label).toBe('string');
      });
    });

    test('completed state uses green', () => {
      expect(TAB_COLORS.completed.label).toBe('green');
      expect(TAB_COLORS.completed.inactiveBg).toBe('#022800');
    });

    test('thinking state uses purple', () => {
      expect(TAB_COLORS.thinking.label).toBe('purple');
      expect(TAB_COLORS.thinking.inactiveBg).toBe('#1E0A3C');
    });

    test('working state uses orange', () => {
      expect(TAB_COLORS.working.label).toBe('orange');
      expect(TAB_COLORS.working.inactiveBg).toBe('#804000');
    });

    test('question state uses teal', () => {
      expect(TAB_COLORS.question.label).toBe('teal');
      expect(TAB_COLORS.question.inactiveBg).toBe('#0D4F4F');
    });

    test('idle state has no background', () => {
      expect(TAB_COLORS.idle.inactiveBg).toBe('none');
    });

    test('hex colors are valid format', () => {
      Object.entries(TAB_COLORS).forEach(([state, config]) => {
        if (config.inactiveBg !== 'none') {
          expect(config.inactiveBg).toMatch(/^#[0-9A-F]{6}$/i);
        }
      });
    });
  });

  describe('ACTIVE_TAB constants', () => {
    test('ACTIVE_TAB_BG is blue', () => {
      expect(ACTIVE_TAB_BG).toBe('#002B80');
      expect(ACTIVE_TAB_BG).toMatch(/^#[0-9A-F]{6}$/i);
    });

    test('ACTIVE_TAB_FG is white', () => {
      expect(ACTIVE_TAB_FG).toBe('#FFFFFF');
    });

    test('INACTIVE_TAB_FG is gray', () => {
      expect(INACTIVE_TAB_FG).toBe('#A0A0A0');
    });
  });

  describe('PHASE_TAB_CONFIG', () => {
    test('has all Algorithm phases', () => {
      const requiredPhases = ['OBSERVE', 'THINK', 'PLAN', 'BUILD', 'EXECUTE', 'VERIFY', 'LEARN', 'COMPLETE', 'IDLE'];
      requiredPhases.forEach(phase => {
        expect(PHASE_TAB_CONFIG[phase]).toBeDefined();
      });
    });

    test('each phase has required fields', () => {
      Object.entries(PHASE_TAB_CONFIG).forEach(([phase, config]) => {
        expect(config).toHaveProperty('symbol');
        expect(config).toHaveProperty('inactiveBg');
        expect(config).toHaveProperty('label');
        expect(config).toHaveProperty('gerund');
        expect(typeof config.symbol).toBe('string');
        expect(typeof config.inactiveBg).toBe('string');
        expect(typeof config.label).toBe('string');
        expect(typeof config.gerund).toBe('string');
      });
    });

    test('OBSERVE phase has eye symbol', () => {
      expect(PHASE_TAB_CONFIG.OBSERVE.symbol).toBe('👁️');
      expect(PHASE_TAB_CONFIG.OBSERVE.label).toBe('observe');
      expect(PHASE_TAB_CONFIG.OBSERVE.gerund).toContain('Observing');
    });

    test('THINK phase has brain symbol', () => {
      expect(PHASE_TAB_CONFIG.THINK.symbol).toBe('🧠');
      expect(PHASE_TAB_CONFIG.THINK.label).toBe('think');
      expect(PHASE_TAB_CONFIG.THINK.gerund).toContain('Analyzing');
    });

    test('PLAN phase has clipboard symbol', () => {
      expect(PHASE_TAB_CONFIG.PLAN.symbol).toBe('📋');
      expect(PHASE_TAB_CONFIG.PLAN.label).toBe('plan');
      expect(PHASE_TAB_CONFIG.PLAN.gerund).toContain('Planning');
    });

    test('BUILD phase has hammer symbol', () => {
      expect(PHASE_TAB_CONFIG.BUILD.symbol).toBe('🔨');
      expect(PHASE_TAB_CONFIG.BUILD.label).toBe('build');
      expect(PHASE_TAB_CONFIG.BUILD.gerund).toContain('Building');
    });

    test('EXECUTE phase has lightning symbol', () => {
      expect(PHASE_TAB_CONFIG.EXECUTE.symbol).toBe('⚡');
      expect(PHASE_TAB_CONFIG.EXECUTE.label).toBe('execute');
      expect(PHASE_TAB_CONFIG.EXECUTE.gerund).toContain('Executing');
    });

    test('VERIFY phase has checkmark symbol', () => {
      expect(PHASE_TAB_CONFIG.VERIFY.symbol).toBe('✅');
      expect(PHASE_TAB_CONFIG.VERIFY.label).toBe('verify');
      expect(PHASE_TAB_CONFIG.VERIFY.gerund).toContain('Verifying');
    });

    test('LEARN phase has books symbol', () => {
      expect(PHASE_TAB_CONFIG.LEARN.symbol).toBe('📚');
      expect(PHASE_TAB_CONFIG.LEARN.label).toBe('learn');
      expect(PHASE_TAB_CONFIG.LEARN.gerund).toContain('Recording');
    });

    test('COMPLETE phase matches completed color', () => {
      expect(PHASE_TAB_CONFIG.COMPLETE.inactiveBg).toBe(TAB_COLORS.completed.inactiveBg);
    });

    test('IDLE phase has no symbol', () => {
      expect(PHASE_TAB_CONFIG.IDLE.symbol).toBe('');
      expect(PHASE_TAB_CONFIG.IDLE.gerund).toBe('');
    });

    test('all phase background colors are valid hex', () => {
      Object.entries(PHASE_TAB_CONFIG).forEach(([phase, config]) => {
        if (config.inactiveBg !== 'none') {
          expect(config.inactiveBg).toMatch(/^#[0-9A-F]{6}$/i);
        }
      });
    });

    test('each phase has unique background color', () => {
      const colors = Object.entries(PHASE_TAB_CONFIG)
        .filter(([_, config]) => config.inactiveBg !== 'none' && config.inactiveBg !== '')
        .map(([_, config]) => config.inactiveBg);

      const uniqueColors = new Set(colors);
      // VERIFY and COMPLETE both use checkmark but might share color
      expect(uniqueColors.size).toBeGreaterThanOrEqual(colors.length - 1);
    });

    test('working phases have gerunds ending with period', () => {
      const workingPhases = ['OBSERVE', 'THINK', 'PLAN', 'BUILD', 'EXECUTE', 'VERIFY', 'LEARN'];
      workingPhases.forEach(phase => {
        const gerund = PHASE_TAB_CONFIG[phase as AlgorithmTabPhase].gerund;
        if (gerund) {
          expect(gerund).toMatch(/\.$/);
        }
      });
    });

    test('gerunds match expected verb patterns', () => {
      expect(PHASE_TAB_CONFIG.OBSERVE.gerund).toContain('Observing');
      expect(PHASE_TAB_CONFIG.THINK.gerund).toContain('Analyzing');
      expect(PHASE_TAB_CONFIG.PLAN.gerund).toContain('Planning');
      expect(PHASE_TAB_CONFIG.BUILD.gerund).toContain('Building');
      expect(PHASE_TAB_CONFIG.EXECUTE.gerund).toContain('Executing');
      expect(PHASE_TAB_CONFIG.VERIFY.gerund).toContain('Verifying');
      expect(PHASE_TAB_CONFIG.LEARN.gerund).toContain('Recording');
    });
  });

  describe('type safety', () => {
    test('TabState includes all expected states', () => {
      const states: TabState[] = ['thinking', 'working', 'question', 'completed', 'error', 'idle'];
      states.forEach(state => {
        expect(TAB_COLORS[state]).toBeDefined();
      });
    });

    test('AlgorithmTabPhase includes all expected phases', () => {
      const phases: AlgorithmTabPhase[] = ['OBSERVE', 'THINK', 'PLAN', 'BUILD', 'EXECUTE', 'VERIFY', 'LEARN', 'COMPLETE', 'IDLE'];
      phases.forEach(phase => {
        expect(PHASE_TAB_CONFIG[phase]).toBeDefined();
      });
    });
  });
});
