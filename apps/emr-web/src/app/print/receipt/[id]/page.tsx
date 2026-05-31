import { prisma } from '@medixus/db';
import {
  age,
  pointsToYen,
  buildBillingBreakdown,
  type CopayRatio,
} from '@medixus/domain';
import { requireSession } from '@/lib/session';
import { PrintButton } from '@/components/print';

/**
 * 領収書／診療明細書 印刷 — FR-BIL-01 / 174項 102.
 * `[id]` は Encounter ID。?detail=1 で診療明細書（点数内訳）も併記。
 * 点→円・自己負担は domain の純関数（buildBillingBreakdown）で算定。
 * 保険算定本体はレセコン委譲のため、診療行為点数(action)・割合(ratio)・自費(self)等は
 * 会計画面から query で受け取る（未指定なら薬剤点数のみ・年齢から既定割合）。
 * DB 未接続/対象なしでもデモ様式を描画（フロントのみモードで画面が必ず出る）。
 */

const cell: React.CSSProperties = { border: '1px solid #000', padding: '6px 10px', fontSize: 13 };
const cellR: React.CSSProperties = { ...cell, textAlign: 'right' };
const th: React.CSSProperties = { ...cell, background: '#f0f0f0', textAlign: 'left' };

type RxLine = { name: string; pricePoints: number; qty: number };
type Loaded = {
  patientName: string;
  patientKana: string;
  patientNo: string;
  patientAge: number | null;
  gender: string;
  clinicName: string;
  date: Date;
  drugPoints: number;
  rxLines: RxLine[];
  demo: boolean;
};

const DEMO: Loaded = {
  patientName: '見本 太郎',
  patientKana: 'ミホン タロウ',
  patientNo: '000123',
  patientAge: 58,
  gender: '男',
  clinicName: 'Medixus Clinic',
  date: new Date(),
  drugPoints: 1.0 * 28 + 4.6 * 28, // = 156.8
  rxLines: [
    { name: 'アムロジピン錠5mg', pricePoints: 1.0, qty: 28 },
    { name: 'ロスバスタチン錠2.5mg', pricePoints: 4.6, qty: 28 },
  ],
  demo: true,
};

function toInt(v: string | undefined, fallback = 0): number {
  if (v == null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function ratioFromAge(a: number | null): CopayRatio {
  if (a == null) return 0.3;
  if (a < 6) return 0.2;
  if (a >= 75) return 0.1;
  if (a >= 70) return 0.2;
  return 0.3;
}
function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}
function jpDate(d: Date): string {
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
}

async function load(encounterId: string): Promise<Loaded> {
  try {
    const enc = await prisma.encounter.findUnique({ where: { id: encounterId } });
    if (!enc) return DEMO;
    const [patient, rxs] = await Promise.all([
      prisma.patient.findUnique({ where: { id: enc.patientId } }),
      prisma.prescription.findMany({
        where: { encounterId },
        include: { items: { include: { drug: { select: { brandName: true, nhiPrice: true } } } } },
      }),
    ]);
    if (!patient) return DEMO;
    const clinic = await prisma.clinic.findUnique({ where: { id: patient.clinicId } });
    const rxLines: RxLine[] = [];
    for (const rx of rxs) {
      for (const it of rx.items) {
        rxLines.push({
          name: it.drug.brandName,
          pricePoints: Math.round(((it.drug.nhiPrice ?? 0) / 10) * 10) / 10,
          qty: it.dosePerTime * it.timesPerDay * it.days,
        });
      }
    }
    const drugPoints = rxLines.reduce((s, l) => s + l.pricePoints * l.qty, 0);
    return {
      patientName: `${patient.kanjiLastName} ${patient.kanjiFirstName}`,
      patientKana: `${patient.kanaLastName} ${patient.kanaFirstName}`,
      patientNo: patient.patientNo,
      patientAge: age(patient.dateOfBirth),
      gender: patient.gender === 'MALE' ? '男' : patient.gender === 'FEMALE' ? '女' : '—',
      clinicName: clinic?.name ?? 'Medixus Clinic',
      date: enc.createdAt,
      drugPoints,
      rxLines,
      demo: false,
    };
  } catch (err) {
    console.error('[receipt] load failed, demo fallback:', err);
    return DEMO;
  }
}

export default async function ReceiptPrint({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const data = await load(id);
  const showDetail = sp.detail === '1';

  const actionPoints = toInt(sp.action, 0);
  const ratio = toInt(sp.ratio, ratioFromAge(data.patientAge)) as CopayRatio;
  const totalPoints = Math.round(data.drugPoints) + actionPoints;
  const bd = buildBillingBreakdown({
    totalPoints,
    copayRatio: ratio,
    selfPayYen: toInt(sp.self, 0),
    carryOverYen: toInt(sp.carry, 0),
    adjustmentYen: toInt(sp.adj, 0),
  });
  const deposit = toInt(sp.deposit, 0);
  const change = deposit > 0 ? deposit - bd.billedYen : 0;
  const today = jpDate(new Date());

  return (
    <>
      <PrintButton />
      <div className="print-a4 shadow-panel">
        {data.demo && (
          <p className="no-print" style={{ fontSize: 11, color: '#b45309', margin: '0 0 8px' }}>
            ※ デモ様式（DB未接続または対象なし）。実データ接続時に患者・点数が反映されます。
          </p>
        )}

        <h1 style={{ textAlign: 'center', fontSize: 22, letterSpacing: 8, margin: '0 0 4px' }}>
          領 収 書
        </h1>
        <p style={{ textAlign: 'right', fontSize: 12, margin: '0 0 12px' }}>発行日: {today}</p>

        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
          <tbody>
            <tr>
              <td style={th}>患者氏名</td>
              <td style={cell}>
                {data.patientName}（{data.patientKana}）　様
              </td>
              <td style={th}>患者ID</td>
              <td style={cell}>{data.patientNo}</td>
            </tr>
            <tr>
              <td style={th}>年齢 / 性別</td>
              <td style={cell}>
                {data.patientAge != null ? `${data.patientAge}歳` : '—'} / {data.gender}
              </td>
              <td style={th}>診療年月日</td>
              <td style={cell}>{jpDate(data.date)}</td>
            </tr>
          </tbody>
        </table>

        {/* 金額（領収） */}
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={th}>診療報酬総点数</td>
              <td style={cellR}>{bd.totalPoints.toLocaleString()} 点</td>
              <td style={th}>総額（10割）</td>
              <td style={cellR}>{yen(bd.totalYen)}</td>
            </tr>
            <tr>
              <td style={th}>負担割合</td>
              <td style={cellR}>{Math.round(bd.copayRatio * 10)} 割</td>
              <td style={th}>保険一部負担金</td>
              <td style={cellR}>{yen(bd.copayYen)}</td>
            </tr>
            <tr>
              <td style={th}>自費（保険外）</td>
              <td style={cellR}>{yen(bd.selfPayYen)}</td>
              <td style={th}>前回繰越</td>
              <td style={cellR}>{yen(bd.carryOverYen)}</td>
            </tr>
            <tr>
              <td style={th}>調整金</td>
              <td style={cellR}>
                {bd.adjustmentYen < 0 ? '−' : ''}
                {yen(Math.abs(bd.adjustmentYen))}
              </td>
              <td style={{ ...th, background: '#e8f0ff', fontWeight: 700 }}>領収金額</td>
              <td style={{ ...cellR, background: '#e8f0ff', fontSize: 16, fontWeight: 700 }}>
                {yen(bd.billedYen)}
              </td>
            </tr>
            {deposit > 0 && (
              <tr>
                <td style={th}>預り金</td>
                <td style={cellR}>{yen(deposit)}</td>
                <td style={th}>お釣り</td>
                <td style={cellR}>{change < 0 ? `不足 ${yen(-change)}` : yen(change)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <p style={{ fontSize: 11, color: '#444', marginTop: 8 }}>
          ※ 保険点数の算定本体は標準型レセコン／共通算定モジュール（IF-EXT-01）に拠ります。本領収書は
          診療行為点数・薬剤点数の合計から点→円換算・一部負担金を算定し発行しています。
        </p>

        {/* 診療明細書（?detail=1） */}
        {showDetail && (
          <>
            <h2
              style={{
                fontSize: 16,
                marginTop: 26,
                borderBottom: '2px solid #000',
                paddingBottom: 2,
              }}
            >
              診 療 明 細 書
            </h2>
            <p style={{ fontSize: 11, color: '#444', margin: '4px 0 8px' }}>
              （医薬品の点数内訳。診察料・処置・検査等の診療行為明細はレセコン側で出力されます）
            </p>
            {data.rxLines.length === 0 ? (
              <p style={{ fontSize: 13 }}>当該受診に薬剤明細はありません。</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>区分</th>
                    <th style={th}>名称</th>
                    <th style={{ ...th, textAlign: 'right' }}>点/単位</th>
                    <th style={{ ...th, textAlign: 'right' }}>数量</th>
                    <th style={{ ...th, textAlign: 'right' }}>点数</th>
                  </tr>
                </thead>
                <tbody>
                  {actionPoints > 0 && (
                    <tr>
                      <td style={cell}>診療行為</td>
                      <td style={cell}>診察料・処置・検査 ほか（レセコン算定）</td>
                      <td style={cellR}>—</td>
                      <td style={cellR}>—</td>
                      <td style={cellR}>{actionPoints.toLocaleString()}</td>
                    </tr>
                  )}
                  {data.rxLines.map((l, i) => (
                    <tr key={i}>
                      <td style={cell}>投薬</td>
                      <td style={cell}>{l.name}</td>
                      <td style={cellR}>{l.pricePoints}</td>
                      <td style={cellR}>{l.qty}</td>
                      <td style={cellR}>{Math.round(l.pricePoints * l.qty).toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...cell, fontWeight: 700 }} colSpan={4}>
                      合計点数
                    </td>
                    <td style={{ ...cellR, fontWeight: 700 }}>
                      {bd.totalPoints.toLocaleString()} 点（≒ {yen(pointsToYen(bd.totalPoints))}）
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </>
        )}

        <div style={{ marginTop: 30, fontSize: 13, lineHeight: 1.9 }}>
          <p style={{ margin: 0 }}>保険医療機関：{data.clinicName}</p>
          <p style={{ margin: 0 }}>所在地：＿＿＿＿＿＿＿＿＿＿＿＿＿　電話：＿＿＿＿＿＿＿＿</p>
          <p style={{ margin: '8px 0 0', textAlign: 'right' }}>
            領収印　　　　　　　　　　　㊞
          </p>
        </div>
        <p style={{ marginTop: 16, fontSize: 11, color: '#444' }}>
          ※ 本書は Medixus カルテ により発行されました。
        </p>
      </div>
    </>
  );
}
