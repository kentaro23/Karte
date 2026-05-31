import type { JobType } from '@medixus/db';

/**
 * 利用者管理の共有定数 — FR-SEC-06 / 174:169。
 *
 * `actions.ts` は 'use server' 指定のため async 関数以外を export できない。
 * UI（page.tsx）と Server Action（actions.ts）の双方が参照する職種リストは本モジュールに置く。
 */

/** 登録可能な職種（`JobType` enum と同一。UI のプルダウンと共有）。 */
export const JOB_TYPES: { value: JobType; label: string }[] = [
  { value: 'DOCTOR', label: '医師' },
  { value: 'RESIDENT', label: '研修医' },
  { value: 'NURSE', label: '看護師' },
  { value: 'PHARMACIST', label: '薬剤師' },
  { value: 'CLERK', label: '医事課' },
  { value: 'TECHNOLOGIST', label: '技師' },
  { value: 'THERAPIST', label: '療法士' },
  { value: 'DIETITIAN', label: '管理栄養士' },
  { value: 'MANAGER', label: '管理者' },
  { value: 'ADMIN', label: 'システム管理者' },
];
