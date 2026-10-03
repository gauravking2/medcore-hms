import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmrController } from './emr.controller';
import { EmrService } from './emr.service';

@Module({
  imports: [forwardRef(() => NotificationsModule)],
  controllers: [EmrController],
  providers: [EmrService],
  exports: [EmrService],
})
export class EmrModule {}
