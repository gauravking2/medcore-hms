import { AppointmentStatus } from '@prisma/client';

// Centralized appointment lifecycle. Controllers/services must use this —
// no scattered transition rules elsewhere.
const ALLOWED: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function assertValidTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (from === to) return;
  const allowed = ALLOWED[from] ?? [];
  if (!allowed.includes(to)) {
    const error = new Error(`Invalid status transition from ${from} to ${to}.`);
    (error as NodeJS.ErrnoException).code = 'INVALID_TRANSITION';
    throw error;
  }
}

export function isSlotOccupying(status: AppointmentStatus): boolean {
  return status !== 'CANCELLED' && status !== 'NO_SHOW';
}
