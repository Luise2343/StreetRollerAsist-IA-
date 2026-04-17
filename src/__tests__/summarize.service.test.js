import { describe, it, expect, vi } from 'vitest';

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Mocked summary' } }]
        })
      }
    };
  }
}));

vi.mock('../config/db.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    connect: vi.fn()
  }
}));

import { mergeFacts } from '../services/summarize.service.js';

describe('mergeFacts', () => {
  it('merges name from next into prev', () => {
    const result = mergeFacts({ name: 'Old' }, { name: 'New' });
    expect(result.name).toBe('New');
  });

  it('keeps prev name when next has no name', () => {
    const result = mergeFacts({ name: 'Old' }, {});
    expect(result.name).toBe('Old');
  });

  it('merges preferences objects shallowly', () => {
    const result = mergeFacts(
      { preferences: { budget: '100', size: 'M' } },
      { preferences: { size: 'L', color: 'red' } }
    );
    expect(result.preferences).toMatchObject({ budget: '100', size: 'L', color: 'red' });
  });

  it('handles empty prev', () => {
    const result = mergeFacts({}, { name: 'Ana', preferences: { cat: 'x' } });
    expect(result.name).toBe('Ana');
    expect(result.preferences).toEqual({ cat: 'x' });
  });

  it('handles empty next', () => {
    const prev = { name: 'Ana', preferences: { a: 1 }, notes: 'n' };
    const result = mergeFacts(prev, {});
    expect(result).toMatchObject(prev);
  });

  it('overwrites notes with next value', () => {
    const result = mergeFacts({ notes: 'old note' }, { notes: 'new note' });
    expect(result.notes).toBe('new note');
  });

  it('handles undefined prev gracefully', () => {
    const result = mergeFacts(undefined, { name: 'Ana' });
    expect(result.name).toBe('Ana');
  });
});
