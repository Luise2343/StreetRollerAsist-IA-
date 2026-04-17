import { describe, it, expect } from 'vitest';
import { getContext, pushTurn, clearSession } from '../services/context.js';

const T = 1;

describe('context.js', () => {
  it('returns empty turns for a new session', () => {
    const ctx = getContext(T, 'ctx-test-new');
    expect(ctx.turns).toEqual([]);
  });

  it('pushTurn adds a turn to the session', () => {
    const waId = 'ctx-test-push';
    pushTurn(T, waId, 'hello', 'hi there');
    const ctx = getContext(T, waId);
    expect(ctx.turns).toHaveLength(1);
    expect(ctx.turns[0]).toMatchObject({ user: 'hello', assistant: 'hi there' });
  });

  it('pushTurn stores string representations', () => {
    const waId = 'ctx-test-string';
    pushTurn(T, waId, null, undefined);
    const ctx = getContext(T, waId);
    expect(typeof ctx.turns[0].user).toBe('string');
    expect(typeof ctx.turns[0].assistant).toBe('string');
  });

  it('clearSession removes the session', () => {
    const waId = 'ctx-test-clear';
    pushTurn(T, waId, 'msg', 'reply');
    clearSession(T, waId);
    const ctx = getContext(T, waId);
    expect(ctx.turns).toEqual([]);
  });

  it('pushTurn trims to MAX_TURNS (default 6)', () => {
    const waId = 'ctx-test-overflow';
    const maxTurns = Number(process.env.CTX_TURNS ?? 6);
    for (let i = 0; i < maxTurns + 5; i++) {
      pushTurn(T, waId, `user ${i}`, `bot ${i}`);
    }
    const ctx = getContext(T, waId);
    expect(ctx.turns.length).toBeLessThanOrEqual(maxTurns);
    expect(ctx.turns.length).toBeGreaterThan(0);
  });

  it('multiple sessions are isolated per tenant and waId', () => {
    const waId1 = 'ctx-isolated-1';
    const waId2 = 'ctx-isolated-2';
    pushTurn(T, waId1, 'user1 msg', 'bot1 reply');
    const ctx2 = getContext(T, waId2);
    expect(ctx2.turns).toEqual([]);
  });

  it('same waId different tenant are isolated', () => {
    const waId = 'same-wa';
    pushTurn(1, waId, 'a', 'b');
    const ctxOther = getContext(2, waId);
    expect(ctxOther.turns).toEqual([]);
  });
});
