import { describe, it, expect } from 'bun:test';
import { detectPattern1, detectPattern2 } from '../hooks/InstinctCapture.hook';

describe('detectPattern1', () => {
  it('detects "no don\'t" after tool call', () => {
    const messages = [
      { role: 'user', hasToolCall: false, text: 'do something' },
      { role: 'assistant', hasToolCall: true, text: 'I edited the file' },
    ];
    expect(detectPattern1("no don't do that", messages)).toBe(true);
  });

  it('does NOT fire without preceding tool call', () => {
    const messages = [
      { role: 'user', hasToolCall: false, text: 'discuss something' },
      { role: 'assistant', hasToolCall: false, text: 'here is my thought' },
    ];
    expect(detectPattern1("no don't use rm -rf in the script", messages)).toBe(false);
  });

  it('detects "no stop" after tool call', () => {
    const messages = [
      { role: 'assistant', hasToolCall: true, text: 'I wrote to the file' },
    ];
    expect(detectPattern1('no stop doing that', messages)).toBe(true);
  });

  it('does NOT fire on bare "no" in code context without tool call gate', () => {
    const messages = [
      { role: 'user', hasToolCall: false, text: 'can you check something' },
      { role: 'assistant', hasToolCall: false, text: 'sure' },
    ];
    expect(detectPattern1('no this is wrong behavior in code', messages)).toBe(false);
  });

  it('detects "no, please don\'t" after tool call', () => {
    const messages = [
      { role: 'assistant', hasToolCall: true, text: 'Done' },
    ];
    expect(detectPattern1("no please don't add comments to the code", messages)).toBe(true);
  });

  it('does NOT fire on short prompts that are just rating numbers', () => {
    const messages = [{ role: 'assistant', hasToolCall: true, text: 'done' }];
    // Pattern won't match "7" anyway, but confirms no false fire
    expect(detectPattern1('7', messages)).toBe(false);
  });
});

describe('detectPattern2', () => {
  it('detects repeated instruction ≥20 chars', () => {
    const prior = ['always use bun test --bail for faster feedback'];
    expect(detectPattern2('always use bun test --bail for faster feedback please', prior)).not.toBeNull();
  });

  it('does NOT fire on short prior messages', () => {
    const prior = ['short'];
    expect(detectPattern2('short do this', prior)).toBeNull();
  });

  it('returns null when no match', () => {
    const prior = ['write tests for everything in the codebase'];
    expect(detectPattern2('completely different message here please', prior)).toBeNull();
  });

  it('does NOT fire on empty prior messages', () => {
    expect(detectPattern2('some message here and there', [])).toBeNull();
  });
});
