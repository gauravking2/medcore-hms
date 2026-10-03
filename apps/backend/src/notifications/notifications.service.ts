import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { getEnvironment } from '../config/environment';
import { PrismaService } from '../prisma/prisma.service';
import { EmailProvider, SmsProvider } from './messaging.providers';
import { channelPlan, NotificationEvent, templateFor } from './notification.templates';

function connectionOptions() {
  const { REDIS_URL } = getEnvironment();
  const url = new URL(REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379), maxRetriesPerRequest: null as unknown as number };
}

export interface FanOutResult {
  inApp: number;
  email: { delivered: boolean; channel: string } | null;
  sms: { delivered: boolean; channel: string } | null;
}

@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private queue: Queue<NotificationEvent & { dedupeKey: string }> | null = null;
  private worker: Worker<NotificationEvent & { dedupeKey: string }> | null = null;
  private emitSocket: ((userId: string, payload: Record<string, unknown>) => void) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
  ) {}

  setSocketEmitter(emitter: (userId: string, payload: Record<string, unknown>) => void): void {
    this.emitSocket = emitter;
  }

  private getQueue(): Queue<NotificationEvent & { dedupeKey: string }> {
    if (!this.queue) {
      this.queue = new Queue<NotificationEvent & { dedupeKey: string }>('notifications', { connection: connectionOptions() });
    }
    return this.queue;
  }

  async emit(event: NotificationEvent): Promise<FanOutResult> {
    const dedupeKey = `notif:${event.type}:${event.entityType ?? 'none'}:${event.entityId ?? 'none'}:${event.patientId ?? ''}:${event.title}`;
    await this.getQueue().add(event.type, { ...event, dedupeKey }, {
      jobId: dedupeKey.slice(0, 200),
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 200,
    }).catch(() => undefined);
    return this.fanOut(event);
  }

  async fanOut(event: NotificationEvent): Promise<FanOutResult> {
    const plan = channelPlan(event.type);
    const template = templateFor(event.type);
    let inApp = 0;
    let email: FanOutResult['email'] = null;
    let sms: FanOutResult['sms'] = null;

    if (plan.inApp) {
      inApp = await this.deliverInApp(event);
    }
    // Separate handlers: a failed SMS must never block email or in-app.
    if (plan.email && (event.patientEmail || event.type === 'LOW_STOCK')) {
      try {
        const to = event.patientEmail ?? (await this.staffEmail(event.hospitalId));
        if (to) email = await this.email.send({ to, subject: template.emailSubject, text: template.email(event.body) });
      } catch (error) {
        this.logger.warn(`Email fan-out failed: ${(error as Error).message}`);
      }
    }
    if (plan.sms && (event.patientPhone || event.doctorPhone || event.type === 'LOW_STOCK')) {
      try {
        const to = event.doctorPhone ?? event.patientPhone ?? (await this.staffPhone(event.hospitalId));
        if (to) sms = await this.sms.send({ to, text: template.sms(event.body) });
      } catch (error) {
        this.logger.warn(`SMS fan-out failed: ${(error as Error).message}`);
      }
    }
    return { inApp, email, sms };
  }

  private async staffEmail(hospitalId: string): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({ where: { hospitalId, role: 'HOSPITAL_ADMIN' } });
    return admin?.email ?? null;
  }

  private async staffPhone(hospitalId: string): Promise<string | null> {
    const admin = await this.prisma.user.findFirst({ where: { hospitalId, role: 'HOSPITAL_ADMIN' } });
    return admin?.phone ?? null;
  }

  private async deliverInApp(event: NotificationEvent): Promise<number> {
    const recipients = await this.resolveRecipients(event);
    let count = 0;
    for (const userId of recipients) {
      try {
        const created = await this.prisma.notification.create({
          data: { hospitalId: event.hospitalId, userId, title: event.title, body: event.body, entityType: event.entityType, entityId: event.entityId },
        });
        count += 1;
        if (this.emitSocket) {
          try {
            this.emitSocket(userId, { id: created.id, title: created.title, body: created.body, entityType: created.entityType, entityId: created.entityId, createdAt: created.createdAt });
          } catch {
            // Socket delivery is best-effort; the DB row is the source of truth.
          }
        }
      } catch {
        // Idempotent per recipient: duplicates are tolerated but never fatal.
      }
    }
    return count;
  }

  private async resolveRecipients(event: NotificationEvent): Promise<string[]> {
    if (event.patientId) {
      const patient = await this.prisma.patient.findUnique({ where: { id: event.patientId } });
      if (patient?.userId) return [patient.userId];
      return [];
    }
    if (event.doctorUserId) return [event.doctorUserId];
    if (event.type === 'LOW_STOCK') {
      const staff = await this.prisma.user.findMany({ where: { hospitalId: event.hospitalId, role: { in: ['HOSPITAL_ADMIN', 'PHARMACIST'] } }, take: 20 });
      return staff.map((member) => member.id);
    }
    if (event.staffRoles && event.staffRoles.length > 0) {
      const staff = await this.prisma.user.findMany({ where: { hospitalId: event.hospitalId, role: { in: event.staffRoles as never[] } }, take: 20 });
      return staff.map((member) => member.id);
    }
    return [];
  }

  async startWorker(): Promise<void> {
    if (this.worker) return;
    this.worker = new Worker<NotificationEvent & { dedupeKey: string }>(
      'notifications',
      async (job) => {
        const { dedupeKey, ...event } = job.data;
        void dedupeKey;
        await this.fanOut(event);
        return { ok: true };
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
