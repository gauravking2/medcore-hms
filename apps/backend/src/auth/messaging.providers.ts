import { Injectable } from '@nestjs/common';

@Injectable()
export class DevNotificationProvider {
  async sendPasswordReset(_email: string): Promise<{ delivered: false; channel: 'dev' }> {
    void _email;
    return { delivered: false, channel: 'dev' };
  }
}
