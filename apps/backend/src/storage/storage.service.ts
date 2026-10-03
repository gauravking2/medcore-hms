import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export interface StoredFile {
  storedPath: string;
  sizeBytes: number;
}

function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : 'file';
}

@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly root = resolve(process.cwd(), 'apps', 'backend', 'storage');

  async onModuleInit() {
    await fs.mkdir(this.root, { recursive: true });
  }

  async onModuleDestroy() {
    // Local adapter holds no connections.
  }

  async save(namespace: string, originalName: string, mimeType: string, buffer: Buffer): Promise<StoredFile> {
    const safeNamespace = namespace.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'misc';
    const safeName = sanitizeFileName(originalName);
    const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const fileName = `${Date.now()}-${digest}-${safeName}`;
    const directory = join(this.root, safeNamespace);
    await fs.mkdir(directory, { recursive: true });
    const storedPath = join(directory, fileName);
    if (!storedPath.startsWith(this.root + sep)) {
      throw new Error('Invalid storage path.');
    }
    await fs.writeFile(storedPath, buffer);
    this.logger.log(`Stored ${mimeType} upload (${buffer.length} bytes) under ${safeNamespace}.`);
    return { storedPath, sizeBytes: buffer.length };
  }

  async read(storedPath: string): Promise<Buffer> {
    const resolved = resolve(storedPath);
    if (!resolved.startsWith(this.root + sep)) {
      throw new Error('Access to this file is denied.');
    }
    return fs.readFile(resolved);
  }

  randomSuffix(): string {
    return randomBytes(8).toString('hex');
  }
}
