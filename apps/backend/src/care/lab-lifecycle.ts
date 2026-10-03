import { LabOrderStatus } from '@prisma/client';

const FLOW: Record<LabOrderStatus, LabOrderStatus[]> = {
  ORDERED: ['SAMPLE_COLLECTED', 'CANCELLED'],
  SAMPLE_COLLECTED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['RESULT_UPLOADED', 'CANCELLED'],
  RESULT_UPLOADED: ['APPROVED', 'REJECTED'],
  APPROVED: [],
  REJECTED: ['PROCESSING'],
  CANCELLED: [],
};

export function assertLabTransition(from: LabOrderStatus, to: LabOrderStatus): void {
  if (from === to) return;
  if (!(FLOW[from] ?? []).includes(to)) {
    const error = new Error(`Invalid lab status transition from ${from} to ${to}.`);
    (error as NodeJS.ErrnoException).code = 'INVALID_LAB_TRANSITION';
    throw error;
  }
}

export function flagForValue(value: number | null | undefined, low: number | null | undefined, high: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (low !== null && low !== undefined && value < low) return 'LOW';
  if (high !== null && high !== undefined && value > high) return 'HIGH';
  if (low === null || low === undefined || high === null || high === undefined) return null;
  return 'NORMAL';
}
