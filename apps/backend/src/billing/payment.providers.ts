import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnvironment } from '../config/environment';

export type PaymentProviderName = 'STRIPE' | 'RAZORPAY' | 'CASH';

export interface IntentResult {
  providerOrderId: string;
  clientPayload: Record<string, unknown>;
}

function sandboxSecret(name: string): string {
  const env = process.env[name];
  if (env && env.length >= 8) return env;
  return `dev-only-${name.toLowerCase()}-sandbox-secret`;
}

@Injectable()
export class PaymentProviders {
  private readonly logger = new Logger(PaymentProviders.name);

  stripeSecret(): string {
    return sandboxSecret('STRIPE_WEBHOOK_SECRET');
  }

  razorpaySecret(): string {
    return sandboxSecret('RAZORPAY_WEBHOOK_SECRET');
  }

  stripePublishableKey(): string {
    return process.env.STRIPE_PUBLISHABLE_KEY ?? 'pk_test_dev_only';
  }

  razorpayKeyId(): string {
    return process.env.RAZORPAY_KEY_ID ?? 'rzp_test_dev_only';
  }

  createStripeIntent(invoiceId: string, amountMinor: number, currency: string): IntentResult {
    const providerOrderId = `pi_dev_${randomBytes(8).toString('hex')}`;
    this.logger.log(`Stripe test intent for invoice ${invoiceId} (${amountMinor} ${currency}).`);
    return { providerOrderId, clientPayload: { publishableKey: this.stripePublishableKey(), clientSecret: `${providerOrderId}_secret_dev`, amountMinor, currency } };
  }

  createRazorpayOrder(invoiceId: string, amountMinor: number, currency: string): IntentResult {
    const providerOrderId = `order_dev_${randomBytes(8).toString('hex')}`;
    this.logger.log(`Razorpay test order for invoice ${invoiceId} (${amountMinor} ${currency}).`);
    return { providerOrderId, clientPayload: { keyId: this.razorpayKeyId(), orderId: providerOrderId, amountMinor, currency } };
  }

  signStripePayload(rawBody: Buffer): string {
    return createHmac('sha256', this.stripeSecret()).update(rawBody).digest('hex');
  }

  verifyStripeSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = this.signStripePayload(rawBody);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  signRazorpayPayload(orderId: string, paymentId: string): string {
    return createHmac('sha256', this.razorpaySecret()).update(`${orderId}|${paymentId}`).digest('hex');
  }

  verifyRazorpaySignature(orderId: string, paymentId: string, signature: string | undefined): boolean {
    if (!signature || !orderId || !paymentId) return false;
    const expected = this.signRazorpayPayload(orderId, paymentId);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  webhookSecretFingerprint(): string {
    return createHash('sha256').update(this.stripeSecret(), 'utf8').digest('hex').slice(0, 12);
  }

  mode(): 'dev' | 'live' {
    const hasStripe = (process.env.STRIPE_WEBHOOK_SECRET ?? '').length >= 8;
    const hasRazorpay = (process.env.RAZORPAY_WEBHOOK_SECRET ?? '').length >= 8;
    void getEnvironment;
    return hasStripe || hasRazorpay ? 'live' : 'dev';
  }
}
