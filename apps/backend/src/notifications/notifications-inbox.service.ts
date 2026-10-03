import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationStatus } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listMine(user: AuthContext, page: { page: number; limit: number; skip: number; unreadOnly?: boolean; status?: NotificationStatus }) {
    const where: { userId: string; status?: NotificationStatus } = { userId: user.userId };
    if (page.unreadOnly) where.status = 'UNREAD';
    else if (page.status) where.status = page.status;
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({ where, skip: page.skip, take: page.limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, total };
  }

  async unreadCount(user: AuthContext) {
    const count = await this.prisma.notification.count({ where: { userId: user.userId, status: 'UNREAD' } });
    return { unread: count };
  }

  async markRead(id: string, user: AuthContext) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Notification not found.' } });
    if (notification.userId !== user.userId) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only read your own notifications.' } });
    }
    const updated = await this.prisma.notification.update({ where: { id }, data: { status: 'READ', readAt: new Date() } });
    await this.audit.record({ userId: user.userId, hospitalId: notification.hospitalId, action: 'notification.read', entityType: 'Notification', entityId: id });
    return updated;
  }

  async markAllRead(user: AuthContext) {
    const result = await this.prisma.notification.updateMany({ where: { userId: user.userId, status: 'UNREAD' }, data: { status: 'READ', readAt: new Date() } });
    return { marked: result.count };
  }
}
