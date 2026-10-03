import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { NotificationStatus } from '@prisma/client';
import { AuthContext } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { ok, paginated, parsePagination } from '../common/response';
import { NotificationsInboxService } from './notifications-inbox.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller()
export class NotificationsController {
  constructor(private readonly inbox: NotificationsInboxService) {}

  @Get('notifications/me')
  async myNotifications(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip } = parsePagination(query);
    const unreadOnly = query.unreadOnly === 'true' || query.unreadOnly === true;
    const result = await this.inbox.listMine(user, { page, limit, skip, unreadOnly });
    return paginated(result.items, page, limit, result.total);
  }

  @Get('notifications/unread-count')
  async unreadCount(@CurrentUser() user: AuthContext) {
    return ok(await this.inbox.unreadCount(user), 'OK');
  }

  @Patch('notifications/:id/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.inbox.markRead(id, user), 'Marked as read.');
  }

  @Patch('notifications/read-all')
  async markAllRead(@CurrentUser() user: AuthContext) {
    return ok(await this.inbox.markAllRead(user), 'All notifications marked as read.');
  }

  @Get('notifications/status/:status')
  async byStatus(@Param('status') status: NotificationStatus, @Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip } = parsePagination(query);
    const result = await this.inbox.listMine(user, { page, limit, skip, status });
    return paginated(result.items, page, limit, result.total);
  }
}
