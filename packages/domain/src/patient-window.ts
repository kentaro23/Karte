/**
 * カルテ取り違え防止 — 別紙1 §3.1(19)(20), 別紙3 #91-92.
 * Up to 5 patient charts open at once; each patient gets a stable, deterministic
 * color so the same patient is always the same color within the session.
 */
export const MAX_OPEN_PATIENTS = 5;

// Distinct, sufficiently-contrasting window accent colors.
export const PATIENT_WINDOW_PALETTE = [
  '#0b5f37', // medixus green
  '#174a7c', // blue
  '#8a2b2b', // red
  '#5b3a8c', // purple
  '#0a6e6e', // teal
] as const;

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function patientWindowColor(patientId: string): string {
  return PATIENT_WINDOW_PALETTE[hashString(patientId) % PATIENT_WINDOW_PALETTE.length]!;
}

export class TooManyOpenPatientsError extends Error {
  constructor() {
    super(`同時に開けるカルテは最大 ${MAX_OPEN_PATIENTS} 名までです`);
    this.name = 'TooManyOpenPatientsError';
  }
}

export function assertCanOpenAnother(openPatientIds: readonly string[], patientId: string): void {
  if (openPatientIds.includes(patientId)) return;
  if (openPatientIds.length >= MAX_OPEN_PATIENTS) throw new TooManyOpenPatientsError();
}
