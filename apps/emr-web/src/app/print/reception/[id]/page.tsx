import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { requireSession } from '@/lib/session';
import { PrintButton } from '@/components/print';

// 受付票はサーバーセッション（cookie/headers）に依存するため動的レンダリング。
export const dynamic = 'force-dynamic';

/**
 * FR-RCP-04 受付票（A6）印刷。
 * 受付（Encounter receptionStatus=ARRIVED）の受付番号・患者・診療科・保険を A6 で出力。
 * DB 未接続（フロントのみ）でもデモプロキシが代表レコードを返すため描画される。
 */
export default async function ReceptionSlipPrint({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;

  // すべて fail-soft。見つからなくても「受付票（未確定）」として体裁を出す。
  type EncView = {
    patientId: string;
    departmentId: string;
    insuranceId: string | null;
    receptionNo: number | null;
    visitType: string | null;
    arrivedAt: Date | null;
  };
  type PatientView = {
    clinicId: string;
    patientNo: string;
    kanjiLastName: string;
    kanjiFirstName: string;
    kanaLastName: string;
    kanaFirstName: string;
    dateOfBirth: Date;
    gender: string;
  };
  let enc: EncView | null = null;
  try {
    enc = (await prisma.encounter.findUnique({ where: { id } })) as EncView | null;
  } catch (err) {
    console.error('[ReceptionSlipPrint] encounter fetch failed:', err);
  }

  let patient: PatientView | null = null;
  let department: { name: string } | null = null;
  let clinic: { name: string } | null = null;
  let insurance: { payerType: string; symbol: string | null; number: string | null } | null = null;
  try {
    if (enc?.patientId) {
      patient = (await prisma.patient.findUnique({
        where: { id: enc.patientId },
      })) as PatientView | null;
    }
    if (enc?.departmentId) {
      department = await prisma.department.findUnique({
        where: { id: enc.departmentId },
        select: { name: true },
      });
    }
    clinic = patient
      ? await prisma.clinic.findUnique({ where: { id: patient.clinicId }, select: { name: true } })
      : await prisma.clinic.findFirst({ select: { name: true } });
    if (enc?.insuranceId) {
      insurance = await prisma.insurance.findUnique({
        where: { id: enc.insuranceId },
        select: { payerType: true, symbol: true, number: true },
      });
    }
  } catch (err) {
    console.error('[ReceptionSlipPrint] related fetch failed:', err);
  }

  const now = new Date();
  const arrivedAt = enc?.arrivedAt ? new Date(enc.arrivedAt) : now;
  const visitLabel =
    enc?.visitType === 'FIRST' ? '初診' : enc?.visitType === 'RETURN' ? '再診' : '—';
  const payerLabel: Record<string, string> = {
    SOCIAL: '社保',
    NATIONAL: '国保',
    LATE_ELDERLY: '後期高齢',
    SELF_PAY: '自費',
    PUBLIC: '公費',
  };
  const insLabel = insurance
    ? `${payerLabel[insurance.payerType] ?? insurance.payerType}${
        insurance.symbol || insurance.number
          ? ` ${insurance.symbol ?? ''}${insurance.symbol && insurance.number ? '-' : ''}${insurance.number ?? ''}`
          : ''
      }`
    : '自費 / 未登録';

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <tr>
      <th
        style={{
          border: '1px solid #000',
          background: '#f2f2f2',
          padding: '4px 6px',
          width: '32%',
          textAlign: 'left',
          fontSize: 11,
          fontWeight: 600,
          verticalAlign: 'middle',
        }}
      >
        {label}
      </th>
      <td style={{ border: '1px solid #000', padding: '4px 6px', fontSize: 12 }}>{value}</td>
    </tr>
  );

  return (
    <>
      {/* A6 用紙設定（このページのみ。グローバルは A4 のため局所上書き）。 */}
      <style>{`
        @media print {
          @page { size: A6 portrait; margin: 6mm; }
          html, body { background: #fff; }
          .no-print { display: none !important; }
          .reception-slip { box-shadow: none !important; margin: 0 !important; width: auto !important; }
        }
      `}</style>

      <PrintButton />

      <div
        className="reception-slip shadow-panel"
        style={{
          width: '105mm',
          minHeight: '148mm',
          margin: '0 auto',
          padding: '8mm 7mm',
          boxSizing: 'border-box',
          background: '#fff',
          color: '#000',
          fontFamily: "'Hiragino Mincho ProN', 'Yu Mincho', serif",
        }}
      >
        <div style={{ textAlign: 'center', borderBottom: '2px solid #000', paddingBottom: 4 }}>
          <div style={{ fontSize: 12 }}>{clinic?.name ?? 'Medixus Clinic'}</div>
          <h1 style={{ fontSize: 18, letterSpacing: 6, margin: '2px 0 0' }}>受 付 票</h1>
        </div>

        <div
          style={{
            textAlign: 'center',
            margin: '8px 0',
          }}
        >
          <div style={{ fontSize: 11, color: '#333' }}>受付番号</div>
          <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>
            {enc?.receptionNo ?? '—'}
          </div>
          <div style={{ fontSize: 11, marginTop: 2 }}>
            {department?.name ?? '—'}　/　{visitLabel}
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
          <tbody>
            <Row
              label="患者氏名"
              value={
                patient
                  ? `${patient.kanjiLastName} ${patient.kanjiFirstName}`
                  : '（患者未確定）'
              }
            />
            <Row
              label="フリガナ"
              value={patient ? `${patient.kanaLastName} ${patient.kanaFirstName}` : '—'}
            />
            <Row label="患者ID" value={patient?.patientNo ?? '—'} />
            <Row
              label="生年月日 / 年齢"
              value={
                patient
                  ? `${patient.dateOfBirth.toLocaleDateString('ja-JP')}（${age(
                      patient.dateOfBirth,
                    )}歳）`
                  : '—'
              }
            />
            <Row
              label="性別"
              value={
                patient
                  ? patient.gender === 'MALE'
                    ? '男'
                    : patient.gender === 'FEMALE'
                      ? '女'
                      : '—'
                  : '—'
              }
            />
            <Row label="保険" value={insLabel} />
            <Row
              label="受付日時"
              value={arrivedAt.toLocaleString('ja-JP', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            />
          </tbody>
        </table>

        <div
          style={{
            marginTop: 10,
            border: '1px dashed #555',
            borderRadius: 4,
            padding: '6px 8px',
            fontSize: 10.5,
            lineHeight: 1.7,
            color: '#222',
          }}
        >
          <p style={{ margin: 0 }}>・お呼びするまで待合でお待ちください。</p>
          <p style={{ margin: 0 }}>・番号でお呼びします。番号札を保管してください。</p>
        </div>

        <p style={{ marginTop: 8, fontSize: 9, color: '#666', textAlign: 'center' }}>
          ※ 本受付票は Medixus カルテ により発行されました。
        </p>
      </div>
    </>
  );
}
