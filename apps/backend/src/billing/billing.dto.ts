import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class InvoiceItemInput {
  @IsIn(['CONSULTATION', 'LAB', 'PHARMACY', 'ROOM', 'OTHER'])
  category!: 'CONSULTATION' | 'LAB' | 'PHARMACY' | 'ROOM' | 'OTHER';

  @IsString()
  @MaxLength(512)
  description!: string;

  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;
}

export class CreateInvoiceDto {
  @IsString()
  appointmentId!: string;

  @IsOptional()
  items?: InvoiceItemInput[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @IsOptional()
  autoItems?: boolean;
}

export class InitiatePaymentDto {
  @IsIn(['STRIPE_CARD', 'RAZORPAY', 'CASH'])
  method!: 'STRIPE_CARD' | 'RAZORPAY' | 'CASH';

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;
}

export class CashPaymentDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  note?: string;
}

export class RefundDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  reason?: string;
}

export class WebhookSimulateDto {
  @IsString()
  invoiceId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  providerPaymentId?: string;
}

export class RazorpaySimulateDto extends WebhookSimulateDto {
  @IsOptional()
  @IsString()
  orderId?: string;
}
