/** Minimal classnames joiner (no dependency). */
export type ClassValue = string | number | false | null | undefined | ClassValue[];

export function cn(...parts: ClassValue[]): string {
  const out: string[] = [];
  const walk = (p: ClassValue) => {
    if (!p && p !== 0) return;
    if (Array.isArray(p)) p.forEach(walk);
    else out.push(String(p));
  };
  parts.forEach(walk);
  return out.join(' ');
}
