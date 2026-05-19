/**
 * Password hashing. Phase 1 uses Node's built-in scrypt (memory-hard, zero native
 * deps → reliable build). PRODUCTION TARGET: Argon2id (別紙3 #13/#68 — hashed, never
 * reversible/plaintext). Swap the impl here without touching callers.
 */
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 16384;
const KEYLEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(plain, salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const salt = Buffer.from(parts[2]!, 'hex');
  const expected = Buffer.from(parts[3]!, 'hex');
  const dk = scryptSync(plain, salt, expected.length, { N: n });
  return dk.length === expected.length && timingSafeEqual(dk, expected);
}

/** 別紙3 #34 — alphanumeric + symbol complexity. */
export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 10) return 'パスワードは10文字以上にしてください';
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw)) return '英大文字・小文字を含めてください';
  if (!/[0-9]/.test(pw)) return '数字を含めてください';
  if (!/[^A-Za-z0-9]/.test(pw)) return '記号を含めてください';
  return null;
}
