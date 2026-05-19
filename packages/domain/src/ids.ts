/** Human-facing identifiers (patient No., order No., prescription No.). */

export function formatPatientNo(seq: number): string {
  return seq.toString().padStart(8, '0');
}

/** Order number: YYYYMMDD + 6-digit sequence (printed on 院外処方箋 等). */
export function formatOrderNo(date: Date, seq: number): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}${m}${d}-${seq.toString().padStart(6, '0')}`;
}

export function age(dob: Date, at: Date = new Date()): number {
  let a = at.getFullYear() - dob.getFullYear();
  const m = at.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && at.getDate() < dob.getDate())) a--;
  return a;
}

export function ageInDays(dob: Date, at: Date = new Date()): number {
  return Math.floor((at.getTime() - dob.getTime()) / 86_400_000);
}
