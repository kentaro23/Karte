import { describe, it, expect } from 'vitest';
import { evaluateDose } from '../dose.js';
import { findDuplicates } from '../duplicate.js';

describe('極量チェック', () => {
  it('blocks when single dose exceeds max', () => {
    expect(evaluateDose({ prescribedSingle: 100, timesPerDay: 3, maxDoseSingle: 50 }).result).toBe('BLOCKED');
  });
  it('blocks when daily dose exceeds max', () => {
    expect(evaluateDose({ prescribedSingle: 20, timesPerDay: 4, maxDoseDaily: 60 }).result).toBe('BLOCKED');
  });
  it('warns (never silently passes) when reference data is missing', () => {
    const r = evaluateDose({ prescribedSingle: 10, timesPerDay: 3 });
    expect(r.result).toBe('WARNING');
    expect(r.message).toContain('未整備');
  });
  it('passes within limits', () => {
    expect(evaluateDose({ prescribedSingle: 10, timesPerDay: 3, maxDoseSingle: 20, maxDoseDaily: 60 }).result).toBe('PASS');
  });
});

describe('重複チェック', () => {
  it('detects same active ingredient (salt-normalized)', () => {
    const d = findDuplicates([
      { itemId: '1', drugName: 'アムロジン', ingredientRootIds: ['amlodipine'], atcCode: 'C08CA01' },
      { itemId: '2', drugName: 'ノルバスク', ingredientRootIds: ['amlodipine'], atcCode: 'C08CA01' },
    ]);
    expect(d.some((x) => x.kind === 'SAME_INGREDIENT')).toBe(true);
  });
  it('no duplicate for distinct drugs', () => {
    const d = findDuplicates([
      { itemId: '1', drugName: 'A', ingredientRootIds: ['x'], atcCode: 'A1' },
      { itemId: '2', drugName: 'B', ingredientRootIds: ['y'], atcCode: 'B1' },
    ]);
    expect(d.length).toBe(0);
  });
});
