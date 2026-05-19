/**
 * 診療録 記載単位の版管理 — 電子保存の三原則(真正性). 別紙1 §3.1, §3.2.
 * APPEND-ONLY: corrections never mutate content; the old version is superseded
 * and a new version row is inserted (previousVersionId chain).
 */
export type RecordStatus = 'EDITING' | 'SAVED' | 'LOCKED' | 'SUPERSEDED';

export type SoapKind = 'S' | 'O' | 'A' | 'P' | 'FREE';
export interface TextSpan {
  text: string;
  marks?: { bold?: boolean; color?: string; size?: 'sm' | 'md' | 'lg' | 'xl' };
}
export interface SoapBlock {
  kind: SoapKind;
  spans: TextSpan[];
}

export const SOAP_LABEL: Record<SoapKind, string> = {
  S: 'S（主観的情報）',
  O: 'O（客観的情報）',
  A: 'A（評価）',
  P: 'P（計画）',
  FREE: 'フリー記載',
};

export function emptySoap(): SoapBlock[] {
  return (['S', 'O', 'A', 'P'] as SoapKind[]).map((kind) => ({ kind, spans: [{ text: '' }] }));
}

export function blocksToPlainText(blocks: SoapBlock[]): string {
  return blocks
    .map((b) => `【${b.kind}】` + b.spans.map((s) => s.text).join(''))
    .join('\n');
}

export interface NoteVersionState {
  id: string;
  version: number;
  rootNoteId: string | null;
  status: RecordStatus;
  lockedAt: Date | null;
}

/** Plan the two writes for an amendment: supersede old + fields for the new version. */
export function planAmendment(current: NoteVersionState): {
  supersede: { id: string; isLatest: false; status: 'SUPERSEDED'; supersededById: string };
  next: {
    version: number;
    rootNoteId: string;
    previousVersionId: string;
    isLatest: true;
    status: 'EDITING';
  };
} {
  if (current.status === 'SUPERSEDED') {
    throw new Error('既に改版済みの記載は再改版できません（最新版を改版してください）');
  }
  const root = current.rootNoteId ?? current.id;
  return {
    supersede: {
      id: current.id,
      isLatest: false,
      status: 'SUPERSEDED',
      supersededById: '<<set-to-new-id>>',
    },
    next: {
      version: current.version + 1,
      rootNoteId: root,
      previousVersionId: current.id,
      isLatest: true,
      status: 'EDITING',
    },
  };
}

/** ロック後は改版のみ可。ロック前は自由編集（別紙1 §3.2(13)(14)）。 */
export function canEditInPlace(status: RecordStatus): boolean {
  return status === 'EDITING' || status === 'SAVED';
}
export function requiresAmendment(status: RecordStatus): boolean {
  return status === 'LOCKED';
}
