import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModel, isExpensiveModel, type ModelData } from '../tierFetcher';

const modelData: Record<string, ModelData> = {
  'claude-3-5-sonnet':  { tier: 'expensive', output: 15 },
  'claude-3-7-sonnet':  { tier: 'expensive', output: 15 },
  'gpt-4o':             { tier: 'expensive', output: 15 },
  'gpt-4o-mini':        { tier: 'cheap',     output: 0.6 },
  'claude-3-haiku':     { tier: 'cheap',     output: 1.25 },
  'o3':                 { tier: 'expensive', output: 40 },
};

describe('resolveModel', () => {
  it('resolves an exact model ID', () => {
    const result = resolveModel('gpt-4o', modelData);
    assert.ok(result);
    assert.equal(result.multiplier, 1);
    assert.equal(result.data.output, 15);
  });

  it('resolves a -thinking suffix variant', () => {
    const result = resolveModel('claude-3-5-sonnet-thinking', modelData);
    assert.ok(result);
    assert.equal(result.multiplier, 2);
    assert.equal(result.data.output, 15);
  });

  it('resolves a -high-thinking suffix variant', () => {
    const result = resolveModel('claude-3-5-sonnet-high-thinking', modelData);
    assert.ok(result);
    assert.equal(result.multiplier, 3);
  });

  it('resolves a -high suffix variant', () => {
    const result = resolveModel('gpt-4o-high', modelData);
    assert.ok(result);
    assert.equal(result.multiplier, 1.5);
  });

  it('returns null for unknown model', () => {
    const result = resolveModel('unknown-model-xyz', modelData);
    assert.equal(result, null);
  });

  it('returns null when suffix variant has no known base', () => {
    const result = resolveModel('nonexistent-thinking', modelData);
    assert.equal(result, null);
  });
});

describe('isExpensiveModel', () => {
  it('marks a model above threshold as expensive', () => {
    const data: ModelData = { tier: 'expensive', output: 15 };
    assert.equal(isExpensiveModel(data, 1, false), false); // 15 < 20
    assert.equal(isExpensiveModel(data, 2, false), true);  // 30 >= 20
  });

  it('marks a cheap model as not expensive', () => {
    const data: ModelData = { tier: 'cheap', output: 0.6 };
    assert.equal(isExpensiveModel(data, 1, false), false);
    assert.equal(isExpensiveModel(data, 3, true), false);  // 0.6 * 3 * 1.2 = 2.16
  });

  it('accounts for max mode multiplier', () => {
    const data: ModelData = { tier: 'expensive', output: 15 };
    // 15 * 1 * 1.2 = 18 — still below 20
    assert.equal(isExpensiveModel(data, 1, true), false);
    // 15 * 1.5 * 1.2 = 27 — above 20
    assert.equal(isExpensiveModel(data, 1.5, true), true);
  });

  it('marks o3 as expensive at baseline', () => {
    const data: ModelData = { tier: 'expensive', output: 40 };
    assert.equal(isExpensiveModel(data, 1, false), true);
  });
});
