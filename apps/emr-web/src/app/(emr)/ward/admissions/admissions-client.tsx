'use client';
import * as React from 'react';
import { Badge, Button, Icon, Modal, Field, Select } from '@medixus/ui';
import { transferPatient } from '../actions';

/* ── 直列化可能な props 型（サーバから受ける） ─────────────────────────── */
export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
export type GenderPolicy = 'MALE' | 'FEMALE' | 'MIXED';

export type BedSlot = {
  bedId: string;
  bedCode: string;
  roomCode: string;
  genderPolicy: GenderPolicy;
  /** 在床患者（空床なら null）。移動シミュレーションの衝突判定に使う。 */
  occupantGender: Gender | null;
  occupantName: string | null;
  /** この在院の Encounter（自分自身の現在地は「移動可」として扱う）。 */
  occupantEncounterId: string | null;
};

export type WardOpt = {
  id: string;
  name: string;
  beds: BedSlot[];
};

export type DeptOpt = { id: string; name: string };

export type Inpatient = {
  encounterId: string;
  patientName: string;
  gender: Gender;
  ageLabel: string;
  wardId: string | null;
  wardName: string;
  departmentId: string;
  departmentName: string;
  bedLabel: string | null;
};

const GENDER_LABEL: Record<Gender, string> = { MALE: '男', FEMALE: '女', OTHER: '他', UNKNOWN: '?' };
const POLICY_LABEL: Record<GenderPolicy, string> = { MALE: '男性専用', FEMALE: '女性専用', MIXED: '男女可' };

/**
 * 性別ポリシー衝突判定 — FR-WRD-01（性別ポリシー）。
 * 病室の genderPolicy が患者の性別と矛盾する場合に警告（ブロックはせず override 可：運用判断）。
 */
function policyConflict(policy: GenderPolicy, gender: Gender): boolean {
  if (policy === 'MIXED') return false;
  if (policy === 'MALE') return gender !== 'MALE';
  if (policy === 'FEMALE') return gender !== 'FEMALE';
  return false;
}

/**
 * 入退院・病床移動シミュレーションのクライアント島 — FR-WRD-01。
 * 在院患者ごとに「転棟／転科／転室」をモーダルで試算し、移動先の空床・性別ポリシー衝突を
 * その場でプレビューしてからサーバアクション（transferPatient）で確定する。
 */
export function AdmissionsClient({
  inpatients,
  wards,
  departments,
  live,
}: {
  inpatients: Inpatient[];
  wards: WardOpt[];
  departments: DeptOpt[];
  live: boolean;
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const target = inpatients.find((p) => p.encounterId === openId) ?? null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {inpatients.length === 0 ? (
          <span className="text-2xs text-muted">在院患者がいないため移動シミュレーションは利用できません。</span>
        ) : (
          inpatients.map((p) => (
            <Button key={p.encounterId} size="sm" variant="ghost" onClick={() => setOpenId(p.encounterId)}>
              <Icon name="switch" size={13} /> {p.patientName} を移動
            </Button>
          ))
        )}
      </div>

      {target && (
        <TransferModal
          key={target.encounterId}
          patient={target}
          wards={wards}
          departments={departments}
          live={live}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function TransferModal({
  patient,
  wards,
  departments,
  live,
  onClose,
}: {
  patient: Inpatient;
  wards: WardOpt[];
  departments: DeptOpt[];
  live: boolean;
  onClose: () => void;
}) {
  const [toWardId, setToWardId] = React.useState<string>(patient.wardId ?? wards[0]?.id ?? '');
  const [toDeptId, setToDeptId] = React.useState<string>(patient.departmentId);
  const [toBedId, setToBedId] = React.useState<string>('');

  const ward = wards.find((w) => w.id === toWardId) ?? null;
  // 空床、または「この患者が今いる床」を移動可能候補とする（自床は実質no-op転室）。
  const selectableBeds = (ward?.beds ?? []).filter(
    (b) => b.occupantEncounterId === null || b.occupantEncounterId === patient.encounterId,
  );
  const selectedBed = selectableBeds.find((b) => b.bedId === toBedId) ?? null;

  const conflict = selectedBed ? policyConflict(selectedBed.genderPolicy, patient.gender) : false;
  const wardChanged = !!toWardId && toWardId !== patient.wardId;
  const deptChanged = !!toDeptId && toDeptId !== patient.departmentId;
  const bedChanged = !!selectedBed && selectedBed.occupantEncounterId !== patient.encounterId;
  const nothingChanged = !wardChanged && !deptChanged && !bedChanged;

  const fromWardName = patient.wardName;
  const toWardName = ward?.name ?? '—';
  const fromDeptName = patient.departmentName;
  const toDeptName = departments.find((d) => d.id === toDeptId)?.name ?? '—';

  const freeCount = (ward?.beds ?? []).filter((b) => b.occupantEncounterId === null).length;

  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={
        <span className="flex items-center gap-2">
          <Icon name="switch" size={16} /> 病床移動シミュレーション — {patient.patientName}（
          {GENDER_LABEL[patient.gender]}・{patient.ageLabel}）
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} type="button">
            閉じる
          </Button>
          <form action={transferPatient}>
            <input type="hidden" name="id" value={patient.encounterId} />
            <input type="hidden" name="toWardId" value={toWardId} />
            <input type="hidden" name="toDepartmentId" value={toDeptId} />
            <input type="hidden" name="toBedCode" value={selectedBed ? `${selectedBed.roomCode}-${selectedBed.bedCode}` : ''} />
            <input
              type="hidden"
              name="reason"
              value={conflict ? `性別ポリシー(${selectedBed ? POLICY_LABEL[selectedBed.genderPolicy] : ''})を運用判断で上書き` : ''}
            />
            <Button variant="primary" type="submit" disabled={nothingChanged}>
              <Icon name="check" size={14} /> {conflict ? '警告を承知で移動を確定' : '移動を確定'}
            </Button>
          </form>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {/* 現在地 → 移動先のプレビュー */}
        <div className="rounded border border-line bg-soft/50 p-3">
          <div className="mb-1.5 text-2xs font-bold uppercase tracking-wider text-muted">移動内容プレビュー</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="text-muted">病棟</span>
            <span>
              {fromWardName} {wardChanged ? <ArrowTo to={toWardName} /> : <Same />}
            </span>
            <span className="text-muted">診療科</span>
            <span>
              {fromDeptName} {deptChanged ? <ArrowTo to={toDeptName} /> : <Same />}
            </span>
            <span className="text-muted">病床</span>
            <span>
              {patient.bedLabel ?? '（未割当）'}{' '}
              {bedChanged ? (
                <ArrowTo to={`${selectedBed!.roomCode}-${selectedBed!.bedCode}`} />
              ) : (
                <Same />
              )}
            </span>
          </div>
        </div>

        {/* 移動先の選択 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="転棟先 病棟">
            <Select
              value={toWardId}
              onChange={(e) => {
                setToWardId(e.target.value);
                setToBedId('');
              }}
            >
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="転科先 診療科">
            <Select value={toDeptId} onChange={(e) => setToDeptId(e.target.value)}>
              {departments.length === 0 && <option value={patient.departmentId}>{patient.departmentName}</option>}
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {/* 移動先病棟の空床一覧（在床/空床・性別ポリシー） */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-2xs font-bold uppercase tracking-wider text-muted">
              {toWardName} の病床（在床/空床・性別ポリシー）
            </span>
            <Badge tone={freeCount > 0 ? 'green' : 'amber'}>空床 {freeCount}</Badge>
          </div>
          {(ward?.beds.length ?? 0) === 0 ? (
            <p className="rounded border border-dashed border-line bg-soft px-2 py-3 text-2xs text-muted">
              この病棟に登録された病床がありません。
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ward!.beds.map((b) => {
                const isSelf = b.occupantEncounterId === patient.encounterId;
                const occupied = b.occupantEncounterId !== null && !isSelf;
                const selected = b.bedId === toBedId;
                const wouldConflict = !occupied && policyConflict(b.genderPolicy, patient.gender);
                return (
                  <button
                    key={b.bedId}
                    type="button"
                    disabled={occupied}
                    onClick={() => setToBedId(b.bedId)}
                    className={[
                      'rounded-card border p-2 text-left text-2xs transition-colors',
                      occupied
                        ? 'cursor-not-allowed border-line bg-soft opacity-70'
                        : selected
                          ? 'border-accent-500 bg-accent-50 ring-1 ring-accent-300'
                          : 'border-dashed border-line bg-white hover:bg-soft',
                    ].join(' ')}
                    title={
                      occupied
                        ? `在床: ${b.occupantName ?? ''}`
                        : wouldConflict
                          ? `性別ポリシー: ${POLICY_LABEL[b.genderPolicy]}`
                          : '空床'
                    }
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-semibold text-ink">
                        {b.roomCode}-{b.bedCode}
                      </span>
                      {isSelf ? (
                        <Badge tone="blue">現在地</Badge>
                      ) : occupied ? (
                        <Badge tone="gray">在床</Badge>
                      ) : (
                        <Badge tone="green">空床</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-muted">
                      {occupied ? (
                        <span>{b.occupantName}</span>
                      ) : (
                        <span className={wouldConflict ? 'text-warn' : ''}>
                          {POLICY_LABEL[b.genderPolicy]}
                          {wouldConflict ? ' ⚠' : ''}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 性別ポリシー衝突の警告（ブロックではなく運用判断で override） */}
        {conflict && selectedBed && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-2xs text-warn">
            <Icon name="warning" size={13} /> 選択した病床 {selectedBed.roomCode}-{selectedBed.bedCode} は
            「{POLICY_LABEL[selectedBed.genderPolicy]}」です。患者は「{GENDER_LABEL[patient.gender]}」のため
            性別ポリシーに反します。やむを得ず割当てる場合は理由が監査に記録されます。
          </div>
        )}
        {nothingChanged && (
          <p className="text-2xs text-muted">転棟先・転科先・転室先のいずれかを変更すると移動を確定できます。</p>
        )}
        {!live && (
          <p className="text-2xs text-muted/70">
            ※ バックエンド未接続のためデモ表示です（操作は可能）。確定すると Encounter の病棟／診療科が更新され、
            移動前後と病床コードが監査ログに記録されます。
          </p>
        )}
      </div>
    </Modal>
  );
}

function ArrowTo({ to }: { to: string }) {
  return (
    <span className="font-semibold text-accent-700">
      <span className="mx-1 text-muted">→</span>
      {to}
    </span>
  );
}
function Same() {
  return <span className="ml-1 text-2xs text-muted">（変更なし）</span>;
}
