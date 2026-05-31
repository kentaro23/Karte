'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { verifyEligibility } from '@medixus/interop';
import { requireSession } from '@/lib/session';

/**
 * FR-PAT-04 保険・公費（増築）— サーバーアクション。
 *
 * 拡張 Insurance（医療保険＝保険者番号/記号/番号/枝番/有効期間 ＋ 公費1-3 ＋
 * 労災自賠 ＋ 特記事項/症状詳記/摘要欄コメント）の登録・更新・除外（論理）。
 * 会計・レセプト・FHIR文書の保険情報源（業務ルール）。
 *
 * いずれの操作も DB 未接続（フロントのみモード）では prisma が例外になり得るため
 * try/catch でフェイルソフトにし、画面が 500 にならないようにする（既存 diagnoses/
 * countersign パターン踏襲）。本番化されたオン資（IF-EXT-02 / insurance-verify）は
 * STUB のため、保険証確認は status:'STUB' を返し「本番接続で取得」と表示する。
 */

/** 保険者区分（payerType）。Insurance.payerType は文字列で保持。 */
export type PayerType = 'SOCIAL' | 'NATIONAL' | 'LATE_ELDERLY' | 'SELF_PAY' | 'PUBLIC';
const PAYER_TYPES: PayerType[] = ['SOCIAL', 'NATIONAL', 'LATE_ELDERLY', 'SELF_PAY', 'PUBLIC'];
function parsePayerType(v: unknown): PayerType {
  const s = String(v ?? '');
  return (PAYER_TYPES as string[]).includes(s) ? (s as PayerType) : 'SOCIAL';
}

/** YYYY-MM-DD → Date（空・不正は undefined）。 */
function parseDate(v: unknown): Date | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function s2null(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s.length ? s : null;
}

export type InsuranceInput = {
  patientId: string;
  payerType: PayerType;
  payerNo: string | null;
  symbol: string | null;
  number: string | null;
  branchNo: string | null;
  publicPayerNo1: string | null;
  publicRecipientNo1: string | null;
  publicPayerNo2: string | null;
  publicRecipientNo2: string | null;
  publicPayerNo3: string | null;
  publicRecipientNo3: string | null;
  workersComp: boolean;
  specialNote: string | null;
  symptomDetail: string | null;
  remarksComment: string | null;
  validFrom: string | null; // YYYY-MM-DD
  validTo: string | null; // YYYY-MM-DD
};

/**
 * 拡張保険を登録する（複数保険＋公費1-3）— FR-PAT-04 AC(1)。
 * 公費は負担者番号/受給者番号のペアを最大3つまで（publicPayerNo1-3 / publicRecipientNo1-3）。
 */
export async function addInsurance(
  input: InsuranceInput,
): Promise<{ ok: boolean; error?: string; demo?: boolean; id?: string }> {
  if (!input.patientId) return { ok: false, error: '患者を指定してください' };
  if (!input.payerNo && input.payerType !== 'SELF_PAY' && !input.publicPayerNo1 && !input.workersComp) {
    return { ok: false, error: '保険者番号・公費・労災のいずれかを入力してください' };
  }
  try {
    const s = await requireSession();
    const created = await prisma.insurance.create({
      data: {
        patientId: input.patientId,
        payerType: input.payerType,
        payerNo: input.payerNo,
        symbol: input.symbol,
        number: input.number,
        branchNo: input.branchNo,
        publicPayerNo1: input.publicPayerNo1,
        publicRecipientNo1: input.publicRecipientNo1,
        publicPayerNo2: input.publicPayerNo2,
        publicRecipientNo2: input.publicRecipientNo2,
        publicPayerNo3: input.publicPayerNo3,
        publicRecipientNo3: input.publicRecipientNo3,
        workersComp: input.workersComp,
        specialNote: input.specialNote,
        symptomDetail: input.symptomDetail,
        remarksComment: input.remarksComment,
        validFrom: parseDate(input.validFrom),
        validTo: parseDate(input.validTo),
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId,
      action: 'CHART_WRITE',
      resource: 'Insurance.create',
      resourceId: created.id,
      detail: {
        payerType: input.payerType,
        payerNo: input.payerNo,
        hasPublic: Boolean(input.publicPayerNo1 || input.publicPayerNo2 || input.publicPayerNo3),
        workersComp: input.workersComp,
      },
    });
    revalidatePath(`/patients/insurance?patientId=${input.patientId}`);
    return { ok: true, id: created.id };
  } catch (err) {
    console.error('[insurance] addInsurance failed (fail-soft):', err);
    // DB未接続でも UI を止めない（フロントのみモード）。
    return { ok: true, demo: true };
  }
}

/** FormData 経路（プログレッシブ拡張：JSなしでも登録できる <form action>）。 */
export async function addInsuranceForm(formData: FormData) {
  await addInsurance({
    patientId: String(formData.get('patientId') || ''),
    payerType: parsePayerType(formData.get('payerType')),
    payerNo: s2null(formData.get('payerNo')),
    symbol: s2null(formData.get('symbol')),
    number: s2null(formData.get('number')),
    branchNo: s2null(formData.get('branchNo')),
    publicPayerNo1: s2null(formData.get('publicPayerNo1')),
    publicRecipientNo1: s2null(formData.get('publicRecipientNo1')),
    publicPayerNo2: s2null(formData.get('publicPayerNo2')),
    publicRecipientNo2: s2null(formData.get('publicRecipientNo2')),
    publicPayerNo3: s2null(formData.get('publicPayerNo3')),
    publicRecipientNo3: s2null(formData.get('publicRecipientNo3')),
    workersComp: formData.get('workersComp') === 'on',
    specialNote: s2null(formData.get('specialNote')),
    symptomDetail: s2null(formData.get('symptomDetail')),
    remarksComment: s2null(formData.get('remarksComment')),
    validFrom: s2null(formData.get('validFrom')),
    validTo: s2null(formData.get('validTo')),
  });
}

/**
 * 有効期間（validFrom/validTo）を更新する。
 * validTo を本日以前にすると会計選択肢から自動除外される — FR-PAT-04 AC(2) の運用手段。
 */
export async function updateValidity(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  const patientId = String(formData.get('patientId') || '');
  if (!id) return;
  try {
    await prisma.insurance.update({
      where: { id },
      data: {
        validFrom: parseDate(formData.get('validFrom')) ?? null,
        validTo: parseDate(formData.get('validTo')) ?? null,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: patientId || null,
      action: 'CHART_WRITE',
      resource: 'Insurance.validity',
      resourceId: id,
      detail: {
        validFrom: s2null(formData.get('validFrom')),
        validTo: s2null(formData.get('validTo')),
      },
    });
  } catch (err) {
    console.error('[insurance] updateValidity failed (fail-soft):', err);
  }
  if (patientId) revalidatePath(`/patients/insurance?patientId=${patientId}`);
}

/**
 * 保険を即時失効させる（validTo を当日に設定）。物理削除はしない＝会計から除外のみ。
 * レセプト/監査の追跡性を保つため履歴は残す。
 */
export async function expireInsurance(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  const patientId = String(formData.get('patientId') || '');
  if (!id) return;
  try {
    await prisma.insurance.update({
      where: { id },
      data: { validTo: new Date() },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: patientId || null,
      action: 'CHART_WRITE',
      resource: 'Insurance.expire',
      resourceId: id,
    });
  } catch (err) {
    console.error('[insurance] expireInsurance failed (fail-soft):', err);
  }
  if (patientId) revalidatePath(`/patients/insurance?patientId=${patientId}`);
}

/**
 * オンライン資格確認（IF-EXT-02 / insurance-verify アダプタ）。
 * 現段階は STUB のため status:'STUB' を返し、UI は「本番接続で取得」と表示する。
 */
export async function verifyInsuranceEligibility(input: {
  patientId: string;
  insurerNo?: string | null;
  symbol?: string | null;
  number?: string | null;
}): Promise<{ status: string; eligible?: boolean; message: string }> {
  try {
    const res = await verifyEligibility({
      patientRef: input.patientId || undefined,
      insurerNo: input.insurerNo ?? undefined,
      symbol: input.symbol ?? undefined,
      number: input.number ?? undefined,
      confirmationDate: new Date().toISOString(),
    });
    try {
      const s = await requireSession();
      await writeAudit({
        actorUserId: s.userId,
        patientId: input.patientId || null,
        action: 'CHART_VIEW',
        resource: 'Insurance.verifyEligibility',
        result: res.status,
      });
    } catch {
      /* 監査はベストエフォート。 */
    }
    if (res.status === 'STUB') {
      return {
        status: 'STUB',
        message: 'オンライン資格確認は連携アダプタ未接続（STUB）です。本番接続でリアルタイム取得されます。',
      };
    }
    return {
      status: res.status,
      eligible: res.data?.eligible,
      message: res.data?.eligible ? '資格確認 OK（有効）' : '資格確認：無効または未取得',
    };
  } catch (err) {
    console.error('[insurance] verifyInsuranceEligibility failed (fail-soft):', err);
    return { status: 'STUB', message: 'オンライン資格確認は本番接続時に実行されます（デモ表示）。' };
  }
}
