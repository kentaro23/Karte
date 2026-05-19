/**
 * 極量チェック (pure, deterministic). Missing reference data is NEVER treated as
 * "safe" — it surfaces as a 要確認 WARNING so a human checks (患者安全).
 */
import type { RuleResult } from '@medixus/rule-engine';

export interface DoseInput {
  prescribedSingle: number; // 1回量
  timesPerDay: number;
  maxDoseSingle?: number | null;
  maxDoseDaily?: number | null;
  usualDoseDaily?: number | null;
}

export function evaluateDose(d: DoseInput): { result: RuleResult; message: string } {
  const prescribedDaily = d.prescribedSingle * d.timesPerDay;

  if (d.maxDoseSingle == null && d.maxDoseDaily == null) {
    return {
      result: 'WARNING',
      message: '極量データ未整備のため自動判定不可（薬剤師・医師確認要）',
    };
  }
  if (d.maxDoseSingle != null && d.prescribedSingle > d.maxDoseSingle) {
    return {
      result: 'BLOCKED',
      message: `1回量 ${d.prescribedSingle} が極量 ${d.maxDoseSingle} を超過`,
    };
  }
  if (d.maxDoseDaily != null && prescribedDaily > d.maxDoseDaily) {
    return {
      result: 'BLOCKED',
      message: `1日量 ${prescribedDaily} が極量 ${d.maxDoseDaily} を超過`,
    };
  }
  if (d.usualDoseDaily != null && prescribedDaily > d.usualDoseDaily) {
    return {
      result: 'WARNING',
      message: `1日量 ${prescribedDaily} が常用量 ${d.usualDoseDaily} を超過（極量未満）`,
    };
  }
  return { result: 'PASS', message: '用量適正' };
}
