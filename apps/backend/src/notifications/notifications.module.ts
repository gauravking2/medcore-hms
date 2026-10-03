import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getEnvironment } from '../config/environment';
import { EmailProvider, SmsProvider } from './messaging.providers';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsInboxService } from './notifications-inbox.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [JwtModule.register({ secret: getEnvironment().JWT_SECRET })],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsInboxService, NotificationsGateway, EmailProvider, SmsProvider],
  exports: [NotificationsService, NotificationsGateway, EmailProvider, SmsProvider],
})
export class NotificationsModule {}
