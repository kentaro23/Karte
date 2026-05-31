/**
 * 警告管理（無効化制御）の共有定数 — FR-RXSAFE-05 / ギャップ G13。
 *
 * `actions.ts` は 'use server' 指定のため async 関数以外を export できない。
 * UI（page.tsx）と Server Action（actions.ts）の双方が参照する定数は本モジュールに置く。
 */

/** 抑止不可のチェック種類（安全側で固定）。アレルギーは常に抑止できない。 */
export const NON_SUPPRESSIBLE_CHECK_TYPES = ['ALLERGY'] as const;
