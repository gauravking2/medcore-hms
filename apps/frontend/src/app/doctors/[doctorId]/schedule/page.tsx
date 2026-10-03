'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { use, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { Field, Input } from '../../../../components/ui/input';
import { DataTable } from '../../../../components/ui/collections';
import { Breadcrumbs, ErrorCard, LoadingSkeleton, PageHeader, StateCard, StatusBadge } from '../../../../components/ui/states';
import { ApiError, apiGet, apiPatch, apiPost } from '../../../../lib/api';
import { useAuthStore } from '../../../../lib/auth-store';

interface Availability {
  id: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  slotMinutes: number;
  isActive: boolean;
}

interface Appointment {
  id: string;
  startsAt: string;
  endsAt: string;
  status: string;
  isEmergency: boolean;
  patient?: { firstName: string; lastName: string };
}

const availabilitySchema = z.object({
  weekday: z.coerce.number().min(0).max(6),
  startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.'),
  endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.'),
  slotMinutes: z.coerce.number().min(5).max(480).default(30),
});

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function DoctorSchedulePage({ params }: { params: Promise<{ doctorId: string }> }) {
  const { doctorId } = use(params);
  const accessToken = useAuthStore((state) => state.accessToken);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [date, setDate] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const form = useForm<z.infer<typeof availabilitySchema>>({ resolver: zodResolver(availabilitySchema), defaultValues: { weekday: 1, startsAt: '09:00', endsAt: '13:00', slotMinutes: 30 } });

  const availability = useQuery({
    queryKey: ['availability', doctorId],
    queryFn: () => apiGet<Availability[]>(`/doctors/${doctorId}/availability`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });
  const slots = useQuery({
    queryKey: ['slots', doctorId, date],
    queryFn: () => apiGet<{ slots: Array<{ startsAt: string; endsAt: string }> }>(`/doctors/${doctorId}/available-slots?date=${date}`, accessToken ?? undefined),
    enabled: Boolean(accessToken && date),
  });
  const appointments = useQuery({
    queryKey: ['doctor-appointments', doctorId, date],
    queryFn: () =>
      apiGet<{ items: Appointment[] } | Appointment[]>(`/appointments?doctorId=${doctorId}&from=${date}T00:00:00&to=${date}T23:59:59`, accessToken ?? undefined),
    enabled: Boolean(accessToken && date),
  });
  const appointmentList: Appointment[] = useMemo(() => {
    const data = appointments.data;
    if (!data) return [];
    return Array.isArray(data) ? data : data.items;
  }, [appointments.data]);

  async function createAvailability(values: z.infer<typeof availabilitySchema>) {
    setError(null);
    setStatusMessage(null);
    try {
      await apiPost(`/doctors/${doctorId}/availability`, values, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
      setStatusMessage('Availability window created.');
      queryClient.invalidateQueries({ queryKey: ['availability', doctorId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create availability.');
    }
  }

  async function advanceStatus(id: string, status: string) {
    setError(null);
    try {
      await apiPatch(`/appointments/${id}/status`, { status }, accessToken ?? undefined);
      queryClient.invalidateQueries({ queryKey: ['doctor-appointments', doctorId, date] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Status update failed.');
    }
  }

  return (
    <main className="mc-schedule">
      <Breadcrumbs trail={[{ label: 'Command', href: '/dashboard' }, { label: 'Doctor schedule' }]} />
      <PageHeader
        eyebrow={`Doctor ${doctorId.slice(0, 8)}`}
        title="Doctor schedule"
        description="Weekly availability windows generate live bookable slots. Status moves through the clinical lifecycle."
        meta={<span className="mc-open-slots">Open slots {slots.data?.slots.length ?? '—'}</span>}
      />
      <div className="mc-schedule-grid">
        <Card tone="raised" entrance className="mc-schedule-card">
          <h2 className="mc-card-title">Weekly availability</h2>
          {availability.isLoading && <LoadingSkeleton rows={3} />}
          {(availability.data ?? []).length === 0 && !availability.isLoading && <StateCard title="No availability configured" message="Add a weekly window to generate bookable slots." icon="◐" />}
          <ul className="mc-windows">
            {(availability.data ?? []).map((window) => (
              <li key={window.id}>
                <strong>{WEEKDAYS[window.weekday]}</strong>
                <span className="mc-mono">{window.startsAt}–{window.endsAt} · {window.slotMinutes} min</span>
                <StatusBadge status={window.isActive ? 'ACTIVE' : 'SUSPENDED'} />
              </li>
            ))}
          </ul>
          <form className="mc-window-form" onSubmit={form.handleSubmit(createAvailability)}>
            <div className="mc-window-grid">
              <Field label="Weekday 0-6" htmlFor="winWeekday" error={form.formState.errors.weekday?.message}><Input id="winWeekday" type="number" min={0} max={6} placeholder="Weekday 0-6" {...form.register('weekday')} /></Field>
              <Field label="Slot minutes" htmlFor="winSlots"><Input id="winSlots" type="number" placeholder="Slot minutes" {...form.register('slotMinutes')} /></Field>
              <Field label="Starts" htmlFor="winStarts" error={form.formState.errors.startsAt?.message}><Input id="winStarts" placeholder="Starts 09:00" {...form.register('startsAt')} /></Field>
              <Field label="Ends" htmlFor="winEnds" error={form.formState.errors.endsAt?.message}><Input id="winEnds" placeholder="Ends 13:00" {...form.register('endsAt')} /></Field>
            </div>
            <Button disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Saving…' : 'Add window'}</Button>
          </form>
        </Card>
        <Card tone="default" entrance entranceDelay={0.06} className="mc-schedule-card">
          <h2 className="mc-card-title">Daily appointments</h2>
          <Field label="Date" htmlFor="schedDate"><Input id="schedDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          {appointments.isLoading && <LoadingSkeleton rows={4} />}
          {appointmentList.length === 0 && !appointments.isLoading && <StateCard title="Quiet day" message="No appointments for this day yet." icon="◐" />}
          <DataTable
            columns={[
              { key: 'patient', header: 'Patient', render: (appointment: Appointment) => (<><strong>{appointment.patient?.firstName ?? 'Visit'} {appointment.patient?.lastName ?? appointment.id.slice(0, 8)}</strong><span className="mc-row-sub">{new Date(appointment.startsAt).toLocaleString()} {appointment.isEmergency ? '· EMERGENCY' : ''}</span></>) },
              { key: 'status', header: 'Status', render: (appointment: Appointment) => <StatusBadge status={appointment.status} /> },
              {
                key: 'advance', header: 'Advance', align: 'right', render: (appointment: Appointment) => (
                  <span className="mc-status-actions">
                    {['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].map((status) => (
                      <Button key={status} variant="ghost" size="sm" onClick={() => advanceStatus(appointment.id, status)}>{status.replace(/_/g, ' ')}</Button>
                    ))}
                  </span>
                ),
              },
            ]}
            rows={appointmentList}
            keyOf={(appointment) => appointment.id}
            emptyTitle="Quiet day"
            emptyMessage="No appointments for this day yet."
          />
        </Card>
      </div>
      {statusMessage && <p role="status" className="mc-status-ok">{statusMessage}</p>}
      {error && <ErrorCard message={error} />}
      <style jsx>{`
        .mc-schedule { display: grid; gap: 16px; }
        .mc-open-slots { font-size: 0.76rem; font-weight: 800; letter-spacing: 0.06em; border: 1px solid var(--mc-border-strong); border-radius: 999px; padding: 7px 12px; color: var(--mc-text-muted); }
        .mc-schedule-grid { display: grid; gap: 14px; grid-template-columns: 0.9fr 1.1fr; align-items: start; }
        .mc-schedule-card { padding: 20px; display: grid; gap: 12px; }
        .mc-card-title { margin: 0; font-size: 1.02rem; }
        .mc-windows { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .mc-windows li { display: flex; align-items: center; gap: 10px; border: 1px solid var(--mc-border); border-radius: 11px; padding: 10px 12px; font-size: 0.83rem; }
        .mc-windows span { color: var(--mc-text-muted); }
        .mc-windows > li > :last-child { margin-left: auto; }
        .mc-window-form { border-top: 1px solid var(--mc-border); padding-top: 14px; display: grid; gap: 10px; }
        .mc-window-grid { display: grid; gap: 10px; grid-template-columns: 1fr 1fr; }
        .mc-status-ok { border: 1px solid color-mix(in srgb, var(--mc-success) 34%, transparent); background: color-mix(in srgb, var(--mc-success) 10%, transparent); color: var(--mc-success); border-radius: 12px; padding: 10px 12px; font-size: 0.84rem; }
        .mc-row-sub { display: block; font-size: 0.72rem; color: var(--mc-text-faint); }
        .mc-status-actions { display: inline-flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; }
        @media (max-width: 1023px) { .mc-schedule-grid { grid-template-columns: minmax(0, 1fr); } }
        @media (max-width: 640px) { .mc-schedule-card { padding: 16px; } .mc-window-grid { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </main>
  );
}
