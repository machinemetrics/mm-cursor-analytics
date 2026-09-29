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

  it('resolves a -thinking-high suffix variant', () => {
    const result = resolveModel('claude-3-5-sonnet-thinking-high', modelData);
    assert.ok(result);
    assert.equal(result.multiplier, 3);
    assert.equal(result.data.output, 15);
  });

  it('keeps an exact id that ends with -max', () => {
    const data = {
      ...modelData,
      'gpt-5.1-codex': { tier: 'daily driver', output: 14 },
      'gpt-5.1-codex-max': { tier: 'daily driver', output: 10 },
    };
    const result = resolveModel('gpt-5.1-codex-max', data);
    assert.ok(result);
    assert.equal(result.multiplier, 1);
    assert.equal(result.data.output, 10);

    const fast = resolveModel('gpt-5.1-codex-max-fast', data);
    assert.ok(fast);
    assert.equal(fast.multiplier, 1);
    assert.equal(fast.data.output, 10);
  });

  it('resolves effort before a fast variant', () => {
    const data = {
      ...modelData,
      'claude-opus-5-5': { tier: 'expensive', output: 20 },
      'claude-opus-5-5-fast': { tier: 'expensive', output: 40 },
    };
    const result = resolveModel('claude-opus-5-5-high-fast', data);
    assert.ok(result);
    assert.equal(result.data.output, 40);
    assert.equal(result.multiplier, 1.5);

    const xhigh = resolveModel('claude-opus-5-5-xhigh', data);
    assert.ok(xhigh);
    assert.equal(xhigh.data.output, 20);
    assert.equal(xhigh.multiplier, 1);
  });

  it('resolves bracket parameters', () => {
    const data = {
      ...modelData,
      'composer-2.5': { tier: 'cheap', output: 2.5 },
      'composer-2.5-fast': { tier: 'daily driver', output: 15 },
      'claude-opus-5': { tier: 'expensive', output: 25 },
    };
    const fast = resolveModel('composer-2.5[fast=true]', data);
    assert.ok(fast);
    assert.equal(fast.data.output, 15);
    assert.equal(fast.multiplier, 1);

    const standard = resolveModel('composer-2.5[fast=false]', data);
    assert.ok(standard);
    assert.equal(standard.data.output, 2.5);

    const effort = resolveModel('claude-opus-5[effort=high,thinking=true]', data);
    assert.ok(effort);
    assert.equal(effort.data.output, 25);
    assert.equal(effort.multiplier, 3);
  });

  it('maps auto-smart to the auto entry', () => {
    const data = { ...modelData, auto: { tier: 'cheap', output: 6 } };
    const result = resolveModel('auto-smart', data);
    assert.ok(result);
    assert.equal(result.data.tier, 'cheap');
    assert.equal(result.data.output, 6);
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
