'use client';
import * as React from 'react';
import { OverrideDialog, ThreeButtonDx, Badge, Icon, type DxKind } from '@medixus/ui';
import { composeDiseaseName } from '@medixus/domain';
import {
  loadIndicationSuggestions,
  addIndicationDiagnosis,
  overrideWithoutIndication,
  type IndicationSuggestion,
  type DiseaseCandidate,
} from './indication-actions';

/** 修飾語プリ合成のための代表的な修飾語（DX-01 と同思想。決定論・固定リスト）。 */
const DX_MODIFIERS = ['急性', '慢性', '出血性', '術後', '再発', '両側', '右', '左'] as const;

/* ──────────────────────────────────────────────────────────────────────────
   FR-RXSAFE-02 / DX-02 — 🎯適応症ワンクリック病名登録ダイアログ
   ─────────────────────────────────────────────────────────────────────────
   engine の DISEASE_CONTRA finding（適応症未付与 WARNING）を受け、
   [添付文書の効能・効果(DrugIndication)] ＋ [確定/主病/疑い ワンクリック登録]
   を1つのダイアログで提示する。確定で PatientDiagnosis を当日付追加→警告解消。
   病名を付けず保存する場合はオーバーライド理由（PrescriptionOverride）を必須化。
   provenance を各行に表示し AI 非由来を可視化（AC5）。AI 由来データは不使用。
   ────────────────────────────────────────────────────────────────────────── */

/** rx-client が持つ DISEASE_CONTRA finding 互換の最小形（依存を増やさない）。 */
export interface DiseaseContraFinding {
  checkType: string;
  result: string;
  message: string;
  /** engine が積む詳細（itemId / drugProductId / ruleCheckResultId 等） */
  details?: Record<string, unknown> | null;
}

/** ダイアログを開くための対象薬剤コンテキスト。 */
export interface IndicationTarget {
  /** 病名を登録する患者 ID（呼出側＝rx-client が必ず埋める）。 */
  patientId: string;
  /** 表示薬剤名（finding.message から抽出 or 行から） */
  drugName: string;
  drugProductId: string;
  /** 解消対象の RuleCheckResult.id（判明していれば override 紐付けに使う） */
  ruleCheckResultId?: string | null;
  /** 再チェック対象の処方 ID（警告消滅の確認に使う） */
  prescriptionId?: string | null;
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'PMDA_PI_STRUCTURED':
    case 'PMDA_PI_XML':
      return 'PMDA添付文書';
    case 'MHLW_RECEIPT':
      return '厚労省レセ電';
    case 'MEDIS':
      return 'MEDIS標準病名';
    case 'PHARMACIST_VERIFIED':
      return '薬剤師確認済';
    case 'CURATED_SEED':
      return '初期収録';
    default:
      return source;
  }
}

export function IndicationDialog({
  open,
  target,
  onClose,
  onResolved,
}: {
  open: boolean;
  target: IndicationTarget | null;
  onClose: () => void;
  /** 病名追加で警告解消 or 強行（override）完了時に親へ通知（再描画用）。 */
  onResolved?: (info: { resolved: boolean; overridden: boolean }) => void;
}) {
  const [data, setData] = React.useState<IndicationSuggestion | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);
  const [doneResolved, setDoneResolved] = React.useState(false);

  // 手入力＋修飾語プリ合成（候補が無い/別名で付けたい時）。
  const [baseName, setBaseName] = React.useState('');
  const [mods, setMods] = React.useState<string[]>([]);
  // 修飾語選択のたびに病名を合成（決定論・純関数 composeDiseaseName）。
  const composed = React.useMemo(
    () => (baseName.trim() ? composeDiseaseName(baseName.trim(), mods) : ''),
    [baseName, mods],
  );

  // 病名なし強行の理由。
  const [reason, setReason] = React.useState('');

  // 対象が変わるたびに適応症データをロード（fail-soft）。
  React.useEffect(() => {
    if (!open || !target) return;
    setData(null);
    setMsg(null);
    setDoneResolved(false);
    setBaseName('');
    setMods([]);
    setReason('');
    setLoading(true);
    let alive = true;
    loadIndicationSuggestions(target.drugProductId, target.drugName)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {
        if (alive)
          setData({
            ok: true,
            drugProductId: target.drugProductId,
            drugName: target.drugName,
            indications: [],
            candidates: [],
            noVerifiedData: true,
            note: '適応症データの取得に失敗しました（デモ表示）。',
          });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, target]);

  if (!target) return null;

  function toggleMod(m: string) {
    setMods((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  }

  /** 候補（or 手入力合成）を確定/主病/疑いで当日付登録し、警告解消を確認。 */
  function register(
    kind: DxKind,
    payload: { displayName: string; masterCode: string | null; icd10: string | null },
  ) {
    if (!target) return;
    const displayName = payload.displayName.trim();
    if (!displayName) {
      setMsg('病名を入力してください。');
      return;
    }
    start(async () => {
      const r = await addIndicationDiagnosis({
        patientId: target.patientId,
        displayName,
        masterCode: payload.masterCode,
        icd10: payload.icd10,
        kind,
        prescriptionId: target.prescriptionId ?? null,
        drugName: target.drugName,
      });
      handleAddResult(r, displayName, kind);
    });
  }

  function handleAddResult(
    r: Awaited<ReturnType<typeof addIndicationDiagnosis>>,
    displayName: string,
    kind: DxKind,
  ) {
    if (!r.ok) {
      setMsg(r.error ?? '登録に失敗しました。');
      return;
    }
    const kindLabel = kind === 'main' ? '主病' : kind === 'suspected' ? '疑い' : '確定';
    setDoneResolved(r.resolved);
    setMsg(
      r.note ??
        (r.resolved
          ? `「${displayName}」を${kindLabel}・当日付で登録しました。適応症の警告は解消されました。`
          : `「${displayName}」を${kindLabel}・当日付で登録しました。`),
    );
    onResolved?.({ resolved: r.resolved, overridden: false });
  }

  /** 病名を付けずに保存（強行）— 理由必須で PrescriptionOverride 記録。 */
  function override() {
    if (!target) return;
    if (reason.trim().length < 3) {
      setMsg('続行するにはオーバーライド理由（3文字以上）が必要です。');
      return;
    }
    start(async () => {
      const r = await overrideWithoutIndication({
        prescriptionId: target.prescriptionId ?? null,
        ruleCheckResultId: target.ruleCheckResultId ?? null,
        reason: reason.trim(),
        drugName: target.drugName,
      });
      if (!r.ok) {
        setMsg(r.error ?? '続行に失敗しました。');
        return;
      }
      setMsg(r.note ?? '病名を付けずに続行しました（理由を記録）。');
      onResolved?.({ resolved: false, overridden: true });
      onClose();
    });
  }

  const candidates: DiseaseCandidate[] = data?.candidates ?? [];

  const body = (
    <div className="space-y-3 text-xs">
      <p className="text-sm">
        <b>{target.drugName}</b> に該当する有効病名（適応症）が付いていません。
        添付文書の効能・効果から病名をワンクリック登録すると、この警告は解消されます。
      </p>

      {/* 添付文書の効能・効果（provenance 表示＝AI 非由来の検証）。AC2/AC5 */}
      <section>
        <div className="mb-1 flex items-center gap-1 font-semibold text-ink">
          <Icon name="template" size={13} /> 添付文書の効能・効果
        </div>
        {loading ? (
          <p className="text-2xs text-muted">読み込み中…</p>
        ) : data && data.indications.length > 0 ? (
          <ul className="space-y-1">
            {data.indications.map((ind, i) => (
              <li key={i} className="rounded border border-line bg-soft px-2 py-1">
                <div className="text-ink">{ind.indicationText}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-2xs text-muted">
                  {ind.icd10Codes.map((c) => (
                    <Badge key={c} tone="gray">
                      {c}
                    </Badge>
                  ))}
                  <span className="ml-auto inline-flex items-center gap-1">
                    <Icon name="lock" size={11} />
                    出典: {sourceLabel(ind.source)}
                    {ind.isProvisional && <Badge tone="amber">暫定</Badge>}
                    {ind.provenanceVerified ? (
                      <Badge tone="green">AI非由来・検証済</Badge>
                    ) : (
                      <Badge tone="red">出典不明（提示対象外）</Badge>
                    )}
                  </span>
                </div>
                {ind.sourceCitation && (
                  <div className="mt-0.5 text-2xs text-muted">引用: {ind.sourceCitation}</div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded border border-dashed border-line px-2 py-1.5 text-2xs text-muted">
            {data?.note ??
              '添付文書の適応症データが（provenance 厳格に）整備されていません。下の手入力で病名を付与してください。'}
          </p>
        )}
      </section>

      {/* 公式適応病名から 確定/主病/疑い ワンクリック登録。AC3 */}
      <section>
        <div className="mb-1 flex items-center gap-1 font-semibold text-ink">
          <Icon name="check" size={13} /> 適応病名から登録（確定 / 主病 / 疑い）
        </div>
        {candidates.length > 0 ? (
          <ul className="space-y-1">
            {candidates.map((c, i) => (
              <li
                key={`${c.masterCode ?? c.icd10 ?? 'cand'}-${i}`}
                className="flex items-center gap-2 rounded border border-line px-2 py-1"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink">{c.name}</div>
                  <div className="flex items-center gap-1 text-2xs text-muted">
                    {c.icd10 && <Badge tone="gray">{c.icd10}</Badge>}
                    {c.masterCode && <span>標準病名 {c.masterCode}</span>}
                    <span className="ml-1 inline-flex items-center gap-0.5">
                      <Icon name="lock" size={10} /> {sourceLabel(c.source)}
                    </span>
                  </div>
                </div>
                <ThreeButtonDx
                  size="sm"
                  disabled={pending}
                  onPick={(kind) =>
                    register(kind, {
                      displayName: c.name,
                      masterCode: c.masterCode,
                      icd10: c.icd10,
                    })
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-2xs text-muted">
            自動登録できる適応病名候補がありません。下の手入力で病名を作成してください。
          </p>
        )}
      </section>

      {/* 手入力＋修飾語プリ合成（候補が無い/別名で付けたい時）。 */}
      <section className="rounded border border-line p-2">
        <div className="mb-1 flex items-center gap-1 font-semibold text-ink">
          <Icon name="edit" size={13} /> 病名を入力して登録（修飾語プリ合成）
        </div>
        <input
          value={baseName}
          onChange={(e) => setBaseName(e.target.value)}
          placeholder="基本病名（例: 胃潰瘍）"
          className="mb-1 w-full rounded border border-line px-2 py-1 text-xs"
        />
        <div className="mb-1 flex flex-wrap gap-1">
          {DX_MODIFIERS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => toggleMod(m)}
              className={`rounded border px-1.5 py-0.5 text-2xs ${
                mods.includes(m)
                  ? 'border-accent-500 bg-accent-50 text-accent-700'
                  : 'border-line text-muted'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="mb-1 text-2xs text-muted">
          登録名: <span className="font-semibold text-ink">{composed || '（基本病名を入力）'}</span>
        </div>
        <ThreeButtonDx
          size="sm"
          disabled={pending || !composed}
          onPick={(kind) =>
            register(kind, { displayName: composed, masterCode: null, icd10: null })
          }
        />
      </section>

      {msg && (
        <p
          className={`rounded px-2 py-1.5 text-2xs ${
            doneResolved ? 'bg-accent-50 text-accent-700' : 'bg-info/10 text-info'
          }`}
        >
          {msg}
        </p>
      )}

      <p className="text-2xs leading-relaxed text-muted">
        適応症判定は添付文書（PMDA）・標準病名（MEDIS）等の決定論データのみで行い、
        <b>AI 由来データは一切使用しません</b>（provenance を各行に表示）。FR-RXSAFE-02 / DX-02。
      </p>
    </div>
  );

  return (
    <OverrideDialog
      open={open}
      title="適応症がついていません — 病名を登録"
      severity="warn"
      width={620}
      body={body}
      onClose={onClose}
      // 病名を付けず「保存（強行）」する場合は理由必須（AC4 / FR-RXSAFE-04）。
      reasonRequired
      reasonLabel="病名を付けずに保存する理由（必須・監査記録）"
      reasonValue={reason}
      onReasonChange={setReason}
      actions={[
        {
          key: 'override',
          label: '病名なしで保存（強行）',
          variant: 'danger',
          requiresReason: true,
          disabled: pending,
          onClick: override,
        },
      ]}
    />
  );
}

/**
 * DISEASE_CONTRA finding の message から薬剤名を取り出す補助
 * （message 形式は engine 側で `${drugName}: …`）。
 * 呼出側（rx-client）が IndicationTarget を組み立てる際に利用できる。
 * patientId / drugProductId / prescriptionId / ruleCheckResultId は
 * 呼出側が処方行・persistedIds から確実に補う。
 */
export function drugNameFromFinding(finding: DiseaseContraFinding): string {
  const m = finding.message ?? '';
  const idx = m.indexOf(':');
  return (idx > 0 ? m.slice(0, idx) : m).trim();
}

/** DISEASE_CONTRA かつ未付与（WARNING）の finding か判定する補助。 */
export function isUnindicatedFinding(finding: DiseaseContraFinding): boolean {
  return finding.checkType === 'DISEASE_CONTRA' && finding.result === 'WARNING';
}
