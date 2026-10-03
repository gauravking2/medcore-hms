import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: {
    userId?: string | null;
    hospitalId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    ipAddress?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.userId ?? null,
          hospitalId: input.hospitalId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          ipAddress: input.ipAddress ?? null,
          metadata: (input.metadata ?? {}) as object,
        },
      });
    } catch {
      // Audit logging must never break auth flows.
    }
  }
}
