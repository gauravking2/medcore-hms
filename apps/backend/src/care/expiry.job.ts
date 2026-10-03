import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { getEnvironment } from '../config/environment';
import { PrismaService } from '../prisma/prisma.service';

function connectionOptions() {
  const { REDIS_URL } = getEnvironment();
  const url = new URL(REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379), maxRetriesPerRequest: null as unknown as number };
}

export interface ExpiryFinding {
  hospitalId: string;
  medicineId: string;
  medicineName: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: string;
  daysToExpiry: number;
}

@Injectable()
export class ExpiryJob implements OnModuleDestroy {
  private readonly logger = new Logger(ExpiryJob.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue('pharmacy-expiry', { connection: connectionOptions() });
    }
    return this.queue;
  }

  async scanExpiring(withinDays = 30): Promise<ExpiryFinding[]> {
    const horizon = new Date(Date.now() + withinDays * 24 * 3600_000);
    const batches = await this.prisma.inventoryBatch.findMany({
      where: { expiryDate: { lte: horizon }, quantity: { gt: 0 }, quarantined: false },
      include: { medicine: true },
      orderBy: { expiryDate: 'asc' },
      take: 500,
    });
    const now = Date.now();
    return batches.map((batch) => ({
      hospitalId: batch.hospitalId,
      medicineId: batch.medicineId,
      medicineName: batch.medicine.name,
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate.toISOString(),
      quantity: batch.quantity.toString(),
      daysToExpiry: Math.ceil((batch.expiryDate.getTime() - now) / (24 * 3600_000)),
    }));
  }

  async enqueueScan(withinDays = 30): Promise<string> {
    const job = await this.getQueue().add('expiry-scan', { withinDays }, { jobId: `expiry-scan-${withinDays}`, removeOnComplete: 50 });
    return job.id ?? `expiry-scan-${withinDays}`;
  }

  async startWorker(onReport?: (findings: ExpiryFinding[]) => Promise<void>): Promise<void> {
    if (this.worker) return;
    this.worker = new Worker(
      'pharmacy-expiry',
      async (job) => {
        const findings = await this.scanExpiring(Number((job.data as { withinDays?: number }).withinDays ?? 30));
        this.logger.log(`Expiry scan found ${findings.length} batches.`);
        if (onReport) await onReport(findings);
        return { count: findings.length };
      },
      { connection: connectionOptions() },
    );
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.worker = null;
    this.queue = null;
  }
}
