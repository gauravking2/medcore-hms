import { Module, forwardRef } from '@nestjs/common';
import { CareController } from './care.controller';
import { CareService } from './care.service';
import { ExpiryJob } from './expiry.job';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [forwardRef(() => NotificationsModule)],
  controllers: [CareController],
  providers: [CareService, ExpiryJob],
  exports: [CareService, ExpiryJob],
})
export class CareModule {}
