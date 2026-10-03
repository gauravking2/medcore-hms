import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcryptjs';

export const BCRYPT_COST = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$12\$/.test(value);
}
