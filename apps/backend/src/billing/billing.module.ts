import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaymentProviders } from './payment.providers';

@Module({
  imports: [forwardRef(() => NotificationsModule)],
  controllers: [BillingController],
  providers: [BillingService, PaymentProviders],
  exports: [BillingService, PaymentProviders],
})
export class BillingModule {}
