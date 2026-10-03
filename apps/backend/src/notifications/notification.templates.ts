export type NotificationEventType =
  | 'APPOINTMENT_CONFIRMED'
  | 'APPOINTMENT_REMINDER'
  | 'LAB_APPROVED'
  | 'PRESCRIPTION_READY'
  | 'INVOICE_GENERATED'
  | 'PAYMENT_RECEIVED'
  | 'LOW_STOCK'
  | 'EMERGENCY_APPOINTMENT';

export interface NotificationEvent {
  hospitalId: string;
  type: NotificationEventType;
  title: string;
  body: string;
  entityType?: string;
  entityId?: string;
  patientId?: string;
  doctorUserId?: string;
  staffRoles?: string[];
  patientEmail?: string;
  patientPhone?: string;
  doctorPhone?: string;
}

const TEMPLATES: Record<NotificationEventType, { emailSubject: string; email: (body: string) => string; sms: (body: string) => string }> = {
  APPOINTMENT_CONFIRMED: {
    emailSubject: 'Appointment confirmed',
    email: (body) => `${body}\n\nView details in your MedCore portal.`,
    sms: (body) => `MedCore: ${body}`,
  },
  APPOINTMENT_REMINDER: {
    emailSubject: 'Appointment reminder',
    email: (body) => `${body}\n\nPlease arrive 15 minutes early.`,
    sms: (body) => `MedCore reminder: ${body}`,
  },
  LAB_APPROVED: {
    emailSubject: 'Lab report ready',
    email: (body) => `${body}\n\nYour approved report is available in the portal.`,
    sms: (body) => `MedCore: ${body}`,
  },
  PRESCRIPTION_READY: {
    emailSubject: 'Prescription ready',
    email: (body) => `${body}\n\nCollect it from the hospital pharmacy.`,
    sms: (body) => `MedCore: ${body}`,
  },
  INVOICE_GENERATED: {
    emailSubject: 'New invoice',
    email: (body) => `${body}\n\nPay securely from the patient portal.`,
    sms: (body) => `MedCore: ${body}`,
  },
  PAYMENT_RECEIVED: {
    emailSubject: 'Payment received',
    email: (body) => `${body}\n\nYour receipt is available in the portal.`,
    sms: (body) => `MedCore: ${body}`,
  },
  LOW_STOCK: {
    emailSubject: 'Low stock alert',
    email: (body) => `Staff alert: ${body}`,
    sms: (body) => `MedCore stock: ${body}`,
  },
  EMERGENCY_APPOINTMENT: {
    emailSubject: 'Emergency appointment',
    email: (body) => `Urgent: ${body}`,
    sms: (body) => `URGENT MedCore: ${body}`,
  },
};

export function templateFor(type: NotificationEventType) {
  return TEMPLATES[type];
}

export function channelPlan(type: NotificationEventType): { email: boolean; sms: boolean; inApp: boolean } {
  switch (type) {
    case 'APPOINTMENT_CONFIRMED':
      return { email: true, sms: true, inApp: true };
    case 'APPOINTMENT_REMINDER':
      return { email: true, sms: true, inApp: false };
    case 'LAB_APPROVED':
      return { email: true, sms: false, inApp: true };
    case 'PRESCRIPTION_READY':
      return { email: false, sms: true, inApp: true };
    case 'INVOICE_GENERATED':
      return { email: true, sms: false, inApp: true };
    case 'PAYMENT_RECEIVED':
      return { email: true, sms: true, inApp: true };
    case 'LOW_STOCK':
      return { email: true, sms: false, inApp: true };
    case 'EMERGENCY_APPOINTMENT':
      return { email: false, sms: true, inApp: true };
  }
}
