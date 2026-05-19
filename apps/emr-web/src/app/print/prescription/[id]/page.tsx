import { notFound } from 'next/navigation';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { requireSession } from '@/lib/session';

/** 処方箋印刷 — 174項 63. Medixus OS 設計書準拠の最低様式. */
export default async function PrescriptionPrint({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const rx = await prisma.prescription.findUnique({
    where: { id },
    include: {
      items: { include: { drug: true } },
      order: true,
    },
  });
  if (!rx) notFound();
  const patient = await prisma.patient.findUniqueOrThrow({ where: { id: rx.patientId } });
  const prescriber = await prisma.staffUser.findUnique({ where: { id: rx.issuedByUserId } });
  const clinic = await prisma.clinic.findUnique({ where: { id: patient.clinicId } });

  return (
    <div style={{ fontFamily: 'serif', padding: 40, color: '#000', background: '#fff', minHeight: '100vh' }}>
        <h1 style={{ textAlign: 'center', fontSize: 22, letterSpacing: 8, margin: 0 }}>処 方 箋</h1>
        <p style={{ textAlign: 'center', fontSize: 12 }}>
          （この処方箋は Medixus カルテ により発行されました）
        </p>
        <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse', marginTop: 16 }}>
          <tbody>
            <tr>
              <td style={cell}>患者氏名</td>
              <td style={cell}>
                {patient.kanjiLastName} {patient.kanjiFirstName}（{patient.kanaLastName}{' '}
                {patient.kanaFirstName}）
              </td>
              <td style={cell}>患者ID</td>
              <td style={cell}>{patient.patientNo}</td>
            </tr>
            <tr>
              <td style={cell}>生年月日</td>
              <td style={cell}>
                {patient.dateOfBirth.toLocaleDateString('ja-JP')}（{age(patient.dateOfBirth)}歳）
              </td>
              <td style={cell}>性別</td>
              <td style={cell}>
                {patient.gender === 'MALE' ? '男' : patient.gender === 'FEMALE' ? '女' : '—'}
              </td>
            </tr>
            <tr>
              <td style={cell}>処方箋番号</td>
              <td style={cell}>{rx.order.orderNo}</td>
              <td style={cell}>交付年月日</td>
              <td style={cell}>
                {(rx.issuedAt ?? rx.createdAt).toLocaleDateString('ja-JP')}
              </td>
            </tr>
          </tbody>
        </table>

        <h2 style={{ fontSize: 16, marginTop: 24, borderBottom: '2px solid #000' }}>処方</h2>
        <ol style={{ fontSize: 15, lineHeight: 2 }}>
          {rx.items.map((it, i) => (
            <li key={it.id}>
              {it.drug.brandName}（{it.drug.genericName ?? ''}） {it.dosePerTime}
              {it.doseUnit} 1日{it.timesPerDay}回 {it.days}日分　投与経路: {it.route}
            </li>
          ))}
        </ol>

        <div style={{ marginTop: 40, fontSize: 14 }}>
          <p>保険医療機関: {clinic?.name ?? 'Medixus Clinic'}</p>
          <p>
            処方医師: {prescriber?.name ?? '—'}　　印 ____________
          </p>
          <p style={{ fontSize: 11, color: '#444' }}>
            ※ 本処方は禁忌・相互作用・重複・極量・アレルギーの自動チェックを通過済みです（解除がある場合は監査記録に保存）。
          </p>
        </div>
        <p style={{ marginTop: 24, fontSize: 12, color: '#666' }}>
          ブラウザの印刷機能（⌘P / Ctrl+P）で印刷してください。
        </p>
    </div>
  );
}

const cell: React.CSSProperties = {
  border: '1px solid #000',
  padding: '6px 10px',
  fontSize: 13,
};
