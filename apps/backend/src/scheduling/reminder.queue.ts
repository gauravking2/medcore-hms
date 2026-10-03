import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { getEnvironment } from '../config/environment';
import { PrismaService } from '../prisma/prisma.service';

export interface ReminderPayload {
  appointmentId: string;
  hospitalId: string;
  kind: '24h' | '1h';
}

function connectionOptions() {
  const { REDIS_URL } = getEnvironment();
  const url = new URL(REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379), maxRetriesPerRequest: null as unknown as number };
}

@Injectable()
export class ReminderQueue implements OnModuleDestroy {
  private readonly logger = new Logger(ReminderQueue.name);
  private queue: Queue<ReminderPayload> | null = null;
  private events: QueueEvents | null = null;
  private worker: Worker<ReminderPayload> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private getQueue(): Queue<ReminderPayload> {
    if (!this.queue) {
      this.queue = new Queue<ReminderPayload>('appointment-reminders', { connection: connectionOptions() });
    }
    return this.queue;
  }

  async scheduleFor(appointmentId: string, hospitalId: string, startsAt: Date): Promise<{ job24hId: string; job1hId: string }> {
    const queue = this.getQueue();
    const job24hId = `appt-${appointmentId}-24h`;
    const job1hId = `appt-${appointmentId}-1h`;
    const at24h = startsAt.getTime() - 24 * 3600_000;
    const at1h = startsAt.getTime() - 3600_000;
    const delay24h = Math.max(0, at24h - Date.now());
    const delay1h = Math.max(0, at1h - Date.now());
    await queue.add('reminder-24h', { appointmentId, hospitalId, kind: '24h' }, { jobId: job24hId, delay: delay24h, removeOnComplete: 100 });
    await queue.add('reminder-1h', { appointmentId, hospitalId, kind: '1h' }, { jobId: job1hId, delay: delay1h, removeOnComplete: 100 });
    await this.prisma.appointment.update({ where: { id: appointmentId }, data: { reminder24hJobId: job24hId, reminder1hJobId: job1hId } }).catch(() => undefined);
    return { job24hId, job1hId };
  }

  async cancelFor(appointmentId: string): Promise<void> {
    try {
      const queue = this.getQueue();
      await queue.remove(`appt-${appointmentId}-24h`).catch(() => undefined);
      await queue.remove(`appt-${appointmentId}-1h`).catch(() => undefined);
    } catch (error) {
      this.logger.warn(`Reminder cancel failed for ${appointmentId}: ${(error as Error).message}`);
    }
  }

  async startWorker(onDeliver?: (payload: ReminderPayload) => Promise<void>): Promise<void> {
    if (this.worker) return;
    this.worker = new Worker<ReminderPayload>(
      'appointment-reminders',
      async (job) => {
        const appointment = await this.prisma.appointment.findUnique({ where: { id: job.data.appointmentId } });
        if (!appointment || appointment.deletedAt) return;
        if (appointment.status === 'CANCELLED' || appointment.status === 'NO_SHOW') return;
        if (job.data.kind === '24h') {
          await this.prisma.appointment.update({ where: { id: appointment.id }, data: { reminder24hSentAt: new Date() } }).catch(() => undefined);
        } else {
          await this.prisma.appointment.update({ where: { id: appointment.id }, data: { reminder1hSentAt: new Date() } }).catch(() => undefined);
        }
        if (onDeliver) await onDeliver(job.data);
      },
      { connection: connectionOptions() },
    );
    this.events = new QueueEvents('appointment-reminders', { connection: connectionOptions() });
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
    await this.events?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.worker = null;
    this.events = null;
    this.queue = null;
  }
}
