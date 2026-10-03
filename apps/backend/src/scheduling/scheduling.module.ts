import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReminderQueue } from './reminder.queue';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

@Module({
  imports: [forwardRef(() => NotificationsModule)],
  controllers: [SchedulingController],
  providers: [SchedulingService, ReminderQueue],
  exports: [SchedulingService, ReminderQueue],
})
export class SchedulingModule {}
