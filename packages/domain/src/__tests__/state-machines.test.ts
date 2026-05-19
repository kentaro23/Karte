import { describe, it, expect } from 'vitest';
import {
  canTransitionReception,
  assertReceptionTransition,
  waitSeverity,
  canTransitionOrder,
  buildDoOrder,
  planAmendment,
  patientWindowColor,
  assertCanOpenAnother,
  TooManyOpenPatientsError,
  age,
  ageInDays,
} from '../index.js';

describe('診察ステータス FSM', () => {
  it('allows the golden path', () => {
    expect(canTransitionReception('UNRECEIVED', 'ARRIVED')).toBe(true);
    expect(canTransitionReception('READY', 'IN_CONSULTATION')).toBe(true);
    expect(canTransitionReception('IN_CONSULTATION', 'SUSPENDED')).toBe(true);
    expect(canTransitionReception('CONSULTATION_DONE', 'BILLING_DONE')).toBe(true);
  });
  it('rejects illegal jumps', () => {
    expect(canTransitionReception('UNRECEIVED', 'BILLING_DONE')).toBe(false);
    expect(() => assertReceptionTransition('BILLING_DONE', 'ARRIVED')).toThrow();
  });
  it('elapsed-time severity buckets', () => {
    expect(waitSeverity(10)).toBe('normal');
    expect(waitSeverity(45)).toBe('attention');
    expect(waitSeverity(75)).toBe('overdue');
  });
});

describe('オーダ FSM + Doオーダ', () => {
  it('valid lifecycle', () => {
    expect(canTransitionOrder('DRAFT', 'REQUESTED')).toBe(true);
    expect(canTransitionOrder('DONE', 'APPROVED')).toBe(true);
    expect(canTransitionOrder('APPROVED', 'DRAFT')).toBe(false);
  });
  it('Doオーダ clones payload and resets lifecycle', () => {
    const d = buildDoOrder({ id: 'o1', orderType: 'RX', departmentId: 'dep', detail: { rp: [1] } });
    expect(d.doSourceOrderId).toBe('o1');
    expect(d.status).toBe('DRAFT');
    expect(d.detail).toEqual({ rp: [1] });
  });
});

describe('診療録 版管理 (append-only)', () => {
  it('plans supersede + new version', () => {
    const p = planAmendment({ id: 'n1', version: 1, rootNoteId: null, status: 'LOCKED', lockedAt: new Date() });
    expect(p.supersede.status).toBe('SUPERSEDED');
    expect(p.next.version).toBe(2);
    expect(p.next.previousVersionId).toBe('n1');
    expect(p.next.rootNoteId).toBe('n1');
  });
  it('refuses to re-amend a superseded note', () => {
    expect(() =>
      planAmendment({ id: 'n0', version: 1, rootNoteId: null, status: 'SUPERSEDED', lockedAt: null }),
    ).toThrow();
  });
});

describe('カルテ取り違え防止', () => {
  it('deterministic per-patient color', () => {
    expect(patientWindowColor('pX')).toBe(patientWindowColor('pX'));
  });
  it('max 5 open patients', () => {
    const open = ['a', 'b', 'c', 'd', 'e'];
    expect(() => assertCanOpenAnother(open, 'f')).toThrow(TooManyOpenPatientsError);
    expect(() => assertCanOpenAnother(open, 'c')).not.toThrow(); // already open is fine
  });
});

describe('age helpers', () => {
  it('computes years and days', () => {
    const dob = new Date('2000-01-01T00:00:00Z');
    const at = new Date('2026-01-01T00:00:00Z');
    expect(age(dob, at)).toBe(26);
    expect(ageInDays(dob, at)).toBeGreaterThan(9000);
  });
});
