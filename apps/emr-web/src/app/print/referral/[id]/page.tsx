import { notFound } from 'next/navigation';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { requireSession } from '@/lib/session';
import { PrintButton } from '@/components/print';

/** 診療情報提供書（紹介状）印刷 — 174項 22。 */
export default async function ReferralPrint({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const s = await requireSession();
  const { id } = await params;
  const r = await prisma.referral.findUnique({ where: { id } });
  if (!r) notFound();
  const patient = r.patientId
    ? await prisma.patient.findUnique({ where: { id: r.patientId } })
    : null;
  const clinic = patient
    ? await prisma.clinic.findUnique({ where: { id: patient.clinicId } })
    : await prisma.clinic.findFirst();
  const today = new Date().toLocaleDateString('ja-JP');

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <tr>
      <th
        style={{
          border: '1px solid #000',
          background: '#f0f0f0',
          padding: '6px 8px',
          width: '28%',
          textAlign: 'left',
          fontSize: 13,
          verticalAlign: 'top',
        }}
      >
        {label}
      </th>
      <td style={{ border: '1px solid #000', padding: '6px 8px', fontSize: 13 }}>{children}</td>
    </tr>
  );

  return (
    <>
      <PrintButton />
      <div className="print-a4 shadow-panel">
        <h1 style={{ textAlign: 'center', fontSize: 20, letterSpacing: 4, margin: '0 0 4px' }}>
          診 療 情 報 提 供 書
        </h1>
        <p style={{ textAlign: 'right', fontSize: 12, margin: '0 0 14px' }}>発行日: {today}</p>

        <p style={{ fontSize: 14, margin: '0 0 2px' }}>
          {r.partnerFacility}　御中
        </p>
        {r.partnerDoctor && (
          <p style={{ fontSize: 13, margin: '0 0 14px' }}>{r.partnerDoctor} 先生</p>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <tbody>
            <Row label="患者氏名">
              {patient
                ? `${patient.kanjiLastName} ${patient.kanjiFirstName}（${patient.kanaLastName} ${patient.kanaFirstName}）`
                : '（患者未指定）'}
            </Row>
            <Row label="生年月日 / 性別">
              {patient
                ? `${patient.dateOfBirth.toLocaleDateString('ja-JP')}（${age(
                    patient.dateOfBirth,
                  )}歳） / ${
                    patient.gender === 'MALE' ? '男' : patient.gender === 'FEMALE' ? '女' : '—'
                  }`
                : '—'}
            </Row>
            <Row label="紹介目的">{r.purpose}</Row>
            <Row label="主訴・症状">{r.chiefComplaint || '—'}</Row>
            <Row label="現病歴・経過・現症">
              <div style={{ whiteSpace: 'pre-wrap', minHeight: 110 }}>{r.diseaseState || ''}</div>
            </Row>
            <Row label="既往歴・治療経過">
              <div style={{ minHeight: 70 }} />
            </Row>
            <Row label="現在の処方">
              <div style={{ minHeight: 70 }} />
            </Row>
            <Row label="備考">
              <div style={{ minHeight: 50 }} />
            </Row>
          </tbody>
        </table>

        <div style={{ marginTop: 28, fontSize: 13, lineHeight: 1.9 }}>
          <p style={{ margin: 0 }}>紹介元医療機関：{clinic?.name ?? 'Medixus Clinic'}</p>
          <p style={{ margin: 0 }}>所在地：＿＿＿＿＿＿＿＿＿＿＿＿＿　電話：＿＿＿＿＿＿＿＿</p>
          <p style={{ margin: '8px 0 0' }}>
            医師氏名：{s.name}　　　　　　　　　印
          </p>
        </div>
        <p style={{ marginTop: 18, fontSize: 11, color: '#444' }}>
          ※ 本書は Medixus カルテ により作成されました。
        </p>
      </div>
    </>
  );
}
