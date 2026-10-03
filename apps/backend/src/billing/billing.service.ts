import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChargeCategory, InvoiceStatus, PaymentMethod, PaymentProvider, PaymentStatus, Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../auth/auth.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvoiceDto, InitiatePaymentDto } from './billing.dto';
import { assertInvoiceTransition } from './invoice-lifecycle';
import { PaymentProviders } from './payment.providers';
import { renderReceiptPdf } from './receipt-pdf';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly providers: PaymentProviders,
    private readonly notifications: NotificationsService,
  ) {}

  private assertSameHospital(user: AuthContext, hospitalId: string) {
    if (user.role !== 'SUPER_ADMIN' && user.hospitalId !== hospitalId) {
      throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'Access to another hospital is denied.' } });
    }
  }

  private async invoiceInScope(id: string, user: AuthContext, roles: string[]) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: { items: true, patient: true, appointment: true, payments: true } });
    if (!invoice) throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Invoice not found.' } });
    if (!roles.includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission for invoices.' } });
    }
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== invoice.patientId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only view your own invoices.' } });
      }
      return invoice;
    }
    this.assertSameHospital(user, invoice.hospitalId);
    return invoice;
  }

  async createInvoice(dto: CreateInvoiceDto, user: AuthContext, ip?: string | null) {
    if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'ACCOUNTANT'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You cannot create invoices.' } });
    }
    const appointment = await this.prisma.appointment.findUnique({ where: { id: dto.appointmentId }, include: { doctor: true } });
    if (!appointment || appointment.deletedAt) {
      throw new NotFoundException({ success: false, error: { code: 'NOT_FOUND', message: 'Appointment not found.' } });
    }
    if (user.role !== 'SUPER_ADMIN') this.assertSameHospital(user, appointment.hospitalId);
    const existing = await this.prisma.invoice.findUnique({ where: { appointmentId: dto.appointmentId } });
    if (existing) {
      throw new ForbiddenException({ success: false, error: { code: 'INVOICE_EXISTS', message: 'An invoice already exists for this appointment.' } });
    }
    const items = [...(dto.items ?? [])];
    if (dto.autoItems !== false && items.length === 0) {
      const consultationFee = Number(appointment.doctor.consultationFee ?? 75);
      items.push({ category: 'CONSULTATION', description: `Consultation — ${appointment.doctor.specialization}`, quantity: 1, unitPrice: consultationFee });
      const labOrders = await this.prisma.labOrder.count({ where: { medicalRecord: { appointmentId: appointment.id } } });
      void labOrders;
    }
    if (items.length === 0) {
      throw new ForbiddenException({ success: false, error: { code: 'INVOICE_EMPTY', message: 'At least one line item is required.' } });
    }
    // Server-calculated totals: quantity x unitPrice per line. Client totals ignored.
    const computed = items.map((item) => ({ ...item, amount: round2(Number(item.quantity) * Number(item.unitPrice)) }));
    const subtotal = round2(computed.reduce((sum, item) => sum + item.amount, 0));
    const tax = round2(Number(dto.tax ?? 0));
    const total = round2(subtotal + tax);
    const invoiceNumber = `INV-${appointment.hospitalId.slice(0, 4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
    const invoice = await this.prisma.invoice.create({
      data: {
        hospital: { connect: { id: appointment.hospitalId } },
        appointment: { connect: { id: appointment.id } },
        patient: { connect: { id: appointment.patientId } },
        invoiceNumber,
        status: 'DRAFT',
        paymentStatus: 'UNPAID',
        subtotal,
        tax,
        total,
        currency: dto.currency ?? 'USD',
        items: {
          create: computed.map((item) => ({
            hospital: { connect: { id: appointment.hospitalId } },
            category: item.category as ChargeCategory,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
          })),
        },
      },
      include: { items: true },
    });
    await this.audit.record({ userId: user.userId, hospitalId: appointment.hospitalId, action: 'invoice.create', entityType: 'Invoice', entityId: invoice.id, ipAddress: ip ?? null, metadata: { total } });
    await this.notifications.emit({
      hospitalId: appointment.hospitalId,
      type: 'INVOICE_GENERATED',
      title: 'Invoice generated',
      body: `Invoice ${invoiceNumber} for ${total} is ready.`,
      entityType: 'Invoice',
      entityId: invoice.id,
      patientId: appointment.patientId,
    }).catch(() => undefined);
    return invoice;
  }

  async listInvoices(user: AuthContext, query: { page: number; limit: number; skip: number; status?: string; paymentStatus?: string; patientId?: string; hospitalId?: string; search?: string }) {
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own) return { items: [], total: 0 };
      const where: Prisma.InvoiceWhereInput = { patientId: own.id };
      if (query.status) where.status = query.status as InvoiceStatus;
      if (query.paymentStatus) where.paymentStatus = query.paymentStatus as PaymentStatus;
      const [items, total] = await Promise.all([
        this.prisma.invoice.findMany({ where, skip: query.skip, take: query.limit, orderBy: { createdAt: 'desc' }, include: { items: true, payments: true } }),
        this.prisma.invoice.count({ where }),
      ]);
      return { items, total };
    }
    if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'ACCOUNTANT', 'DOCTOR'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'You do not have permission for invoices.' } });
    }
    const scope = user.role === 'SUPER_ADMIN' ? query.hospitalId : user.hospitalId;
    if (!scope) return { items: [], total: 0 };
    this.assertSameHospital(user, scope);
    const where: Prisma.InvoiceWhereInput = { hospitalId: scope };
    if (query.status) where.status = query.status as InvoiceStatus;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus as PaymentStatus;
    if (query.patientId) where.patientId = query.patientId;
    if (query.search) where.invoiceNumber = { contains: query.search, mode: 'insensitive' };
    const [items, total] = await Promise.all([
      this.prisma.invoice.findMany({ where, skip: query.skip, take: query.limit, orderBy: { createdAt: 'desc' }, include: { items: true, payments: true, patient: true } }),
      this.prisma.invoice.count({ where }),
    ]);
    return { items, total };
  }

  async getInvoice(id: string, user: AuthContext) {
    return this.invoiceInScope(id, user, ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'ACCOUNTANT', 'DOCTOR', 'PATIENT']);
  }

  async finalizeInvoice(id: string, user: AuthContext, ip?: string | null) {
    const invoice = await this.invoiceInScope(id, user, ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'ACCOUNTANT']);
    if (invoice.status !== 'DRAFT') {
      const error = new Error('Only DRAFT invoices can be finalized.');
      (error as NodeJS.ErrnoException).code = 'INVALID_INVOICE_TRANSITION';
      throw error;
    }
    assertInvoiceTransition(invoice.status, 'ISSUED');
    const updated = await this.prisma.invoice.update({ where: { id }, data: { status: 'ISSUED', issuedAt: new Date() }, include: { items: true, payments: true } });
    await this.audit.record({ userId: user.userId, hospitalId: invoice.hospitalId, action: 'invoice.finalize', entityType: 'Invoice', entityId: id, ipAddress: ip ?? null });
    return updated;
  }

  async cancelInvoice(id: string, user: AuthContext, ip?: string | null) {
    const invoice = await this.invoiceInScope(id, user, ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'ACCOUNTANT']);
    if (invoice.paymentStatus === 'PAID') {
      const error = new Error('Paid invoices cannot be cancelled; refund instead.');
      (error as NodeJS.ErrnoException).code = 'INVALID_INVOICE_TRANSITION';
      throw error;
    }
    assertInvoiceTransition(invoice.status, 'VOID');
    const updated = await this.prisma.invoice.update({ where: { id }, data: { status: 'VOID' }, include: { items: true, payments: true } });
    await this.audit.record({ userId: user.userId, hospitalId: invoice.hospitalId, action: 'invoice.cancel', entityType: 'Invoice', entityId: id, ipAddress: ip ?? null });
    return updated;
  }

  async initiatePayment(id: string, dto: InitiatePaymentDto, user: AuthContext, ip?: string | null) {
    const invoice = await this.invoiceInScope(id, user, ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'ACCOUNTANT', 'PATIENT']);
    if (invoice.status === 'VOID' || invoice.status === 'DRAFT') {
      throw new ForbiddenException({ success: false, error: { code: 'INVOICE_NOT_PAYABLE', message: 'Only finalized invoices can accept payment.' } });
    }
    if (invoice.paymentStatus === 'PAID') {
      throw new ForbiddenException({ success: false, error: { code: 'ALREADY_PAID', message: 'Invoice is already paid.' } });
    }
    if (dto.method === 'CASH') {
      throw new ForbiddenException({ success: false, error: { code: 'CASH_VIA_COUNTER', message: 'Cash payments are recorded at the counter by staff.' } });
    }
    if (user.role === 'PATIENT') {
      const own = await this.prisma.patient.findUnique({ where: { userId: user.userId } });
      if (!own || own.id !== invoice.patientId) {
        throw new ForbiddenException({ success: false, error: { code: 'CROSS_HOSPITAL_DENIED', message: 'You can only pay your own invoices.' } });
      }
    }
    const paidSoFar = invoice.payments.filter((payment) => payment.status === 'PAID').reduce((sum, payment) => sum + Number(payment.amount), 0);
    const outstanding = round2(Number(invoice.total) - paidSoFar);
    if (round2(Number(dto.amount)) > outstanding + 0.001) {
      const error = new Error('Amount exceeds the outstanding balance.');
      (error as NodeJS.ErrnoException).code = 'INVALID_AMOUNT';
      throw error;
    }
    const provider: PaymentProvider = dto.method === 'STRIPE_CARD' ? 'STRIPE' : 'RAZORPAY';
    const amountMinor = Math.round(Number(dto.amount) * 100);
    const currency = dto.currency ?? invoice.currency;
    const intent = dto.method === 'STRIPE_CARD'
      ? this.providers.createStripeIntent(invoice.id, amountMinor, currency)
      : this.providers.createRazorpayOrder(invoice.id, amountMinor, currency);
    const idempotencyKey = `init:${provider}:${intent.providerOrderId}`;
    const payment = await this.prisma.payment.create({
      data: {
        hospital: { connect: { id: invoice.hospitalId } },
        invoice: { connect: { id: invoice.id } },
        amount: dto.amount,
        currency,
        method: dto.method as PaymentMethod,
        provider,
        providerOrderId: intent.providerOrderId,
        status: 'PENDING',
        idempotencyKey,
      },
    });
    await this.prisma.invoice.update({ where: { id }, data: { paymentStatus: 'PENDING', status: invoice.status === 'ISSUED' ? 'ISSUED' : invoice.status } });
    await this.audit.record({ userId: user.userId, hospitalId: invoice.hospitalId, action: 'payment.initiate', entityType: 'Payment', entityId: payment.id, ipAddress: ip ?? null, metadata: { provider, amount: Number(dto.amount) } });
    return { payment, intent: intent.clientPayload, provider, mode: this.providers.mode() };
  }

  private async applyPaidAmount(invoiceId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!invoice) return;
    const paidTotal = invoice.payments.filter((payment) => payment.status === 'PAID').reduce((sum, payment) => sum + Number(payment.amount), 0);
    const total = Number(invoice.total);
    let paymentStatus: PaymentStatus = 'UNPAID';
    let status = invoice.status;
    if (paidTotal >= total - 0.001 && total > 0) {
      paymentStatus = 'PAID';
      status = 'PAID';
    } else if (paidTotal > 0) {
      paymentStatus = 'PARTIALLY_PAID';
      if (status === 'ISSUED') status = 'PARTIALLY_PAID';
    }
    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { paymentStatus, status, paidAt: paymentStatus === 'PAID' ? new Date() : invoice.paidAt, paymentProviderReference: invoice.payments.find((payment) => payment.status === 'PAID')?.providerPaymentId ?? invoice.paymentProviderReference },
    });
  }

  async recordCashPayment(id: string, amount: number, user: AuthContext, ip?: string | null, note?: string) {
    if (!['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'ACCOUNTANT'].includes(user.role)) {
      throw new ForbiddenException({ success: false, error: { code: 'FORBIDDEN', message: 'Only staff can record cash payments.' } });
    }
    const invoice = await this.invoiceInScope(id, user, ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'ACCOUNTANT']);
    if (invoice.status === 'VOID' || invoice.status === 'DRAFT') {
      throw new ForbiddenException({ success: false, error: { code: 'INVOICE_NOT_PAYABLE', message: 'Only finalized invoices can accept payment.' } });
    }
    const paidSoFar = invoice.payments.filter((payment) => payment.status === 'PAID').reduce((sum, payment) => sum + Number(payment.amount), 0);
    const outstanding = round2(Number(invoice.total) - paidSoFar);
    if (round2(amount) > outstanding + 0.001 || amount <= 0) {
      const error = new Error('Amount is invalid for the outstanding balance.');
      (error as NodeJS.ErrnoException).code = 'INVALID_AMOUNT';
      throw error;
    }
    const payment = await this.prisma.payment.create({
      data: {
        hospital: { connect: { id: invoice.hospitalId } },
        invoice: { connect: { id: invoice.id } },
        amount,
        currency: invoice.currency,
        method: 'CASH',
        provider: 'CASH',
        status: 'PAID',
        receivedAt: new Date(),
        idempotencyKey: `cash:${invoice.id}:${Date.now()}:${randomBytes(4).toString('hex')}`,
        failureReason: note?.slice(0, 256),
      },
    });
    await this.applyPaidAmount(invoice.id);
    await this.audit.record({ userId: user.userId, hospitalId: invoice.hospitalId, action: 'payment.cash', entityType: 'Payment', entityId: payment.id, ipAddress: ip ?? null, metadata: { amount } });
    await this.notifications.emit({
      hospitalId: invoice.hospitalId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment received',
      body: `Payment of ${amount} ${invoice.currency} recorded for invoice ${invoice.invoiceNumber}.`,
      entityType: 'Invoice',
      entityId: invoice.id,
      patientId: invoice.patientId,
    }).catch(() => undefined);
    return payment;
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string | undefined, payload: { type: string; invoiceId: string; amount: number; paymentIntentId: string }): Promise<{ processed: boolean; duplicate: boolean }> {
    if (!this.providers.verifyStripeSignature(rawBody, signature)) {
      const error = new Error('Invalid webhook signature.');
      (error as NodeJS.ErrnoException).code = 'WEBHOOK_SIGNATURE_INVALID';
      throw error;
    }
    if (payload.type !== 'payment_intent.succeeded') {
      return { processed: false, duplicate: false };
    }
    return this.confirmProviderPayment('STRIPE', payload.paymentIntentId, payload.invoiceId, payload.amount);
  }

  async handleRazorpayWebhook(signature: string | undefined, payload: { orderId: string; paymentId: string; invoiceId: string; amount: number }): Promise<{ processed: boolean; duplicate: boolean }> {
    if (!this.providers.verifyRazorpaySignature(payload.orderId, payload.paymentId, signature)) {
      const error = new Error('Invalid webhook signature.');
      (error as NodeJS.ErrnoException).code = 'WEBHOOK_SIGNATURE_INVALID';
      throw error;
    }
    return this.confirmProviderPayment('RAZORPAY', payload.paymentId, payload.invoiceId, payload.amount, payload.orderId);
  }

  private async confirmProviderPayment(provider: PaymentProvider, providerPaymentId: string, invoiceId: string, amount: number, providerOrderId?: string): Promise<{ processed: boolean; duplicate: boolean }> {
    const idempotencyKey = `webhook:${provider}:${providerPaymentId}`;
    const existing = await this.prisma.payment.findUnique({ where: { idempotencyKey } });
    if (existing) return { processed: true, duplicate: true };
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!invoice) {
      const error = new Error('Invoice not found for webhook.');
      (error as NodeJS.ErrnoException).code = 'NOT_FOUND';
      throw error;
    }
    await this.prisma.payment.create({
      data: {
        hospital: { connect: { id: invoice.hospitalId } },
        invoice: { connect: { id: invoice.id } },
        amount,
        currency: invoice.currency,
        method: provider === 'STRIPE' ? 'STRIPE_CARD' : 'RAZORPAY',
        provider,
        providerOrderId,
        providerPaymentId,
        providerReference: providerPaymentId,
        status: 'PAID',
        receivedAt: new Date(),
        idempotencyKey,
      },
    });
    await this.applyPaidAmount(invoice.id);
    await this.audit.record({ hospitalId: invoice.hospitalId, action: 'payment.webhook', entityType: 'Payment', entityId: providerPaymentId, metadata: { provider, amount } });
    await this.notifications.emit({
      hospitalId: invoice.hospitalId,
      type: 'PAYMENT_RECEIVED',
      title: 'Payment received',
      body: `Online payment of ${amount} ${invoice.currency} confirmed for invoice ${invoice.invoiceNumber}.`,
      entityType: 'Invoice',
      entityId: invoice.id,
      patientId: invoice.patientId,
    }).catch(() => undefined);
    return { processed: true, duplicate: false };
  }

  async receiptPdf(id: string, user: AuthContext) {
    const invoice = await this.invoiceInScope(id, user, ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'RECEPTIONIST', 'ACCOUNTANT', 'PATIENT', 'DOCTOR']);
    const [hospital, patient] = await Promise.all([
      this.prisma.hospital.findUniqueOrThrow({ where: { id: invoice.hospitalId } }),
      this.prisma.patient.findUniqueOrThrow({ where: { id: invoice.patientId } }),
    ]);
    const payments = await this.prisma.payment.findMany({ where: { invoiceId: invoice.id, status: 'PAID' }, orderBy: { createdAt: 'asc' } });
    const paidTotal = round2(payments.reduce((sum, payment) => sum + Number(payment.amount), 0));
    const pdf = await renderReceiptPdf({
      hospitalName: hospital.name,
      hospitalContact: [hospital.email, hospital.phone].filter(Boolean).join(' · ') || hospital.slug,
      patientName: `${patient.firstName} ${patient.lastName}`,
      patientNumber: patient.patientNumber,
      invoiceNumber: invoice.invoiceNumber,
      issuedAt: invoice.issuedAt?.toISOString().slice(0, 10) ?? invoice.createdAt.toISOString().slice(0, 10),
      paidAt: invoice.paidAt?.toISOString().slice(0, 10) ?? null,
      currency: invoice.currency,
      items: invoice.items.map((item) => ({ description: item.description, quantity: Number(item.quantity).toString(), unitPrice: Number(item.unitPrice).toFixed(2), amount: Number(item.amount).toFixed(2) })),
      subtotal: Number(invoice.subtotal).toFixed(2),
      tax: Number(invoice.tax).toFixed(2),
      total: Number(invoice.total).toFixed(2),
      paidTotal: paidTotal.toFixed(2),
      payments: payments.map((payment) => ({ method: payment.method, reference: payment.providerPaymentId ?? payment.providerOrderId ?? payment.id.slice(0, 8), amount: Number(payment.amount).toFixed(2), at: payment.receivedAt?.toISOString().slice(0, 10) ?? payment.createdAt.toISOString().slice(0, 10) })),
    });
    await this.audit.record({ userId: user.userId, hospitalId: invoice.hospitalId, action: 'invoice.receipt', entityType: 'Invoice', entityId: id });
    return pdf;
  }
}
