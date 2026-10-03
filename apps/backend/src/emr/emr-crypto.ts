import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getEnvironment } from '../config/environment';

function key(): Buffer {
  const secret = getEnvironment().JWT_SECRET;
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptText(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptText(payload: string): string {
  const [scheme, ivHex, tagHex, dataHex] = payload.split(':');
  if (scheme !== 'gcm' || !ivHex || !tagHex || !dataHex) return payload;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

export function isEncrypted(payload: string | null | undefined): boolean {
  return typeof payload === 'string' && payload.startsWith('gcm:');
}
