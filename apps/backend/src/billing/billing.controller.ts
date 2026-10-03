import { Body, Controller, Get, Headers, Param, Patch, Post, Query, RawBodyRequest, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthContext } from '../auth/auth.service';
import { CurrentUser } from '../auth/current-user.decorator';
import { Public } from '../auth/public.decorator';
import { ok, paginated, parsePagination } from '../common/response';
import { CashPaymentDto, CreateInvoiceDto, InitiatePaymentDto, RazorpaySimulateDto, WebhookSimulateDto } from './billing.dto';
import { BillingService } from './billing.service';
import { PaymentProviders } from './payment.providers';

@ApiTags('billing')
@ApiBearerAuth()
@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly providers: PaymentProviders,
  ) {}

  @Post('invoices')
  async createInvoice(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.billing.createInvoice(dto, user, request.ip), 'Invoice created.');
  }

  @Get('invoices')
  async listInvoices(@Query() query: Record<string, unknown>, @CurrentUser() user: AuthContext) {
    const { page, limit, skip, search } = parsePagination(query);
    const get = (key: string): string | undefined => (typeof query[key] === 'string' ? (query[key] as string) : undefined);
    const result = await this.billing.listInvoices(user, { page, limit, skip, search, status: get('status'), paymentStatus: get('paymentStatus'), patientId: get('patientId'), hospitalId: get('hospitalId') });
    return paginated(result.items, page, limit, result.total);
  }

  @Get('invoices/:id')
  async getInvoice(@Param('id') id: string, @CurrentUser() user: AuthContext) {
    return ok(await this.billing.getInvoice(id, user), 'OK');
  }

  @Patch('invoices/:id/finalize')
  async finalize(@Param('id') id: string, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.billing.finalizeInvoice(id, user, request.ip), 'Invoice finalized.');
  }

  @Patch('invoices/:id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.billing.cancelInvoice(id, user, request.ip), 'Invoice cancelled.');
  }

  @Post('invoices/:id/payments/initiate')
  async initiate(@Param('id') id: string, @Body() dto: InitiatePaymentDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.billing.initiatePayment(id, dto, user, request.ip), 'Payment session created.');
  }

  @Post('invoices/:id/payments/cash')
  async cash(@Param('id') id: string, @Body() dto: CashPaymentDto, @CurrentUser() user: AuthContext, @Req() request: Request) {
    return ok(await this.billing.recordCashPayment(id, dto.amount, user, request.ip, dto.note), 'Cash payment recorded.');
  }

  @Get('invoices/:id/receipt')
  async receipt(@Param('id') id: string, @CurrentUser() user: AuthContext, @Res() response: Response) {
    const pdf = await this.billing.receiptPdf(id, user);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="receipt-${id}.pdf"`);
    response.send(Buffer.from(pdf));
  }

  @Public()
  @Post('payments/webhook/stripe')
  async stripeWebhook(@Req() request: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string | undefined) {
    const raw = (request as RawBodyRequest<Request>).rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    let payload: { type: string; invoiceId: string; amount: number; paymentIntentId: string };
    try {
      payload = typeof request.body === 'object' && request.body !== null && 'type' in request.body
        ? request.body as { type: string; invoiceId: string; amount: number; paymentIntentId: string }
        : JSON.parse(raw.toString('utf8'));
    } catch {
      const error = new Error('Invalid webhook payload.');
      (error as NodeJS.ErrnoException).code = 'WEBHOOK_SIGNATURE_INVALID';
      throw error;
    }
    return ok(await this.billing.handleStripeWebhook(raw, signature, payload), 'Webhook processed.');
  }

  @Public()
  @Post('payments/webhook/razorpay')
  async razorpayWebhook(@Req() request: Request, @Headers('x-razorpay-signature') signature: string | undefined) {
    const payload = request.body as { orderId: string; paymentId: string; invoiceId: string; amount: number };
    return ok(await this.billing.handleRazorpayWebhook(signature, payload), 'Webhook processed.');
  }

  @Post('payments/webhook/stripe/simulate')
  async stripeSimulate(@Body() dto: WebhookSimulateDto) {
    const payload = { type: 'payment_intent.succeeded', invoiceId: dto.invoiceId, amount: dto.amount, paymentIntentId: dto.providerPaymentId ?? `pi_sim_${Date.now()}` };
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = this.providers.signStripePayload(raw);
    return ok({ ...(await this.billing.handleStripeWebhook(raw, signature, payload)), mode: this.providers.mode() }, 'Simulated webhook processed.');
  }

  @Post('payments/webhook/razorpay/simulate')
  async razorpaySimulate(@Body() dto: RazorpaySimulateDto) {
    const orderId = dto.orderId ?? `order_sim_${Date.now()}`;
    const paymentId = dto.providerPaymentId ?? `pay_sim_${Date.now()}`;
    const signature = this.providers.signRazorpayPayload(orderId, paymentId);
    return ok({ ...(await this.billing.handleRazorpayWebhook(signature, { orderId, paymentId, invoiceId: dto.invoiceId, amount: dto.amount })), mode: this.providers.mode() }, 'Simulated webhook processed.');
  }
}
