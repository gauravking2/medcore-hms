import { InvoiceStatus } from '@prisma/client';

const FLOW: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['ISSUED', 'VOID'],
  ISSUED: ['PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID'],
  PARTIALLY_PAID: ['PAID', 'OVERDUE', 'VOID'],
  PAID: [],
  OVERDUE: ['PARTIALLY_PAID', 'PAID', 'VOID'],
  VOID: [],
};

export function assertInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (from === to) return;
  if (!(FLOW[from] ?? []).includes(to)) {
    const error = new Error(`Invalid invoice transition from ${from} to ${to}.`);
    (error as NodeJS.ErrnoException).code = 'INVALID_INVOICE_TRANSITION';
    throw error;
  }
}

export function finalizeAllowed(status: InvoiceStatus): boolean {
  return status === 'DRAFT';
}
