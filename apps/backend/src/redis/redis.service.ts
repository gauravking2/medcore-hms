import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { getEnvironment } from '../config/environment';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  private getClient(): Redis {
    if (!this.client) {
      const { REDIS_URL } = getEnvironment();
      this.client = new Redis(REDIS_URL, { maxRetriesPerRequest: 3, enableReadyCheck: true });
      this.client.on('error', (error: Error) => this.logger.error(`Redis error: ${error.message}`));
    }
    return this.client;
  }

  async onModuleInit() {
    try {
      await this.getClient().ping();
    } catch (error) {
      this.logger.error(`Redis unavailable at startup: ${(error as Error).message}`);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }

  async get(key: string): Promise<string | null> {
    return this.getClient().get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.getClient().set(key, value, 'EX', ttlSeconds);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.getClient().del(...keys);
  }

  async scanKeys(pattern: string): Promise<string[]> {
    const client = this.getClient();
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }
}
