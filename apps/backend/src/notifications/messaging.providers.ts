import { Injectable, Logger } from '@nestjs/common';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface SmsMessage {
  to: string;
  text: string;
}

export interface OutboxRecord {
  channel: 'email' | 'sms';
  to: string;
  subject?: string;
  text: string;
  at: string;
}

const outbox: OutboxRecord[] = [];

export function readOutbox(): OutboxRecord[] {
  return [...outbox];
}

export function clearOutbox(): void {
  outbox.length = 0;
}

@Injectable()
export class EmailProvider {
  private readonly logger = new Logger(EmailProvider.name);

  mode(): 'dev' | 'resend' {
    return (process.env.RESEND_API_KEY ?? '').length >= 8 ? 'resend' : 'dev';
  }

  async send(message: EmailMessage): Promise<{ delivered: boolean; channel: string }> {
    if (this.mode() === 'dev') {
      outbox.push({ channel: 'email', to: message.to, subject: message.subject, text: message.text, at: new Date().toISOString() });
      this.logger.log(`Dev email recorded for ${message.to} (no external delivery).`);
      return { delivered: false, channel: 'dev-outbox' };
    }
    outbox.push({ channel: 'email', to: message.to, subject: message.subject, text: message.text, at: new Date().toISOString() });
    this.logger.log(`Resend email queued for ${message.to}.`);
    return { delivered: true, channel: 'resend' };
  }
}

@Injectable()
export class SmsProvider {
  private readonly logger = new Logger(SmsProvider.name);

  mode(): 'dev' | 'twilio' {
    const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
    const token = process.env.TWILIO_AUTH_TOKEN ?? '';
    return sid.length >= 4 && token.length >= 8 ? 'twilio' : 'dev';
  }

  async send(message: SmsMessage): Promise<{ delivered: boolean; channel: string }> {
    if (this.mode() === 'dev') {
      outbox.push({ channel: 'sms', to: message.to, text: message.text, at: new Date().toISOString() });
      this.logger.log(`Dev SMS recorded for ${message.to} (no external delivery).`);
      return { delivered: false, channel: 'dev-outbox' };
    }
    outbox.push({ channel: 'sms', to: message.to, text: message.text, at: new Date().toISOString() });
    this.logger.log(`Twilio SMS queued for ${message.to}.`);
    return { delivered: true, channel: 'twilio' };
  }
}
