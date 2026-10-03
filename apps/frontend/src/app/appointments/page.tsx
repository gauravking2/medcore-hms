'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field, Input } from '../../components/ui/input';
import { DataTable, Tabs } from '../../components/ui/collections';
import { LoadingSkeleton, PageHeader, StateCard, StatusBadge } from '../../components/ui/states';
import { ApiError, apiGet, apiPatch, apiPost } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';

interface Doctor {
  id: string;
  specialization: string;
  user?: { email: string };
}

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  patientNumber: string;
}

interface Department {
  id: string;
  name: string;
}

interface Appointment {
  id: string;
  startsAt: string;
  status: string;
}

const bookingSchema = z.object({
  patientId: z.string().min(1, 'Select a patient.'),
  doctorId: z.string().min(1, 'Select a doctor.'),
  departmentId: z.string().min(1, 'Select a department.'),
  startsAt: z.string().min(1, 'Select a slot.'),
  isEmergency: z.boolean().default(false),
  reason: z.string().max(1024).optional(),
});

export default function BookingPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [patientSearch, setPatientSearch] = useState('');
  const [doctorSearch, setDoctorSearch] = useState('');
  const [tab, setTab] = useState<'book' | 'history'>('book');
  const [date, setDate] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const form = useForm<z.infer<typeof bookingSchema>>({ resolver: zodResolver(bookingSchema), defaultValues: { patientId: '', doctorId: '', departmentId: '', startsAt: '', isEmergency: false, reason: '' } });
  const selectedDoctor = form.watch('doctorId');

  // Picker data is only readable by clinical/admin roles. Firing these for a
  // PATIENT produced 403s on every page view, so gate them the same way the
  // dashboard gates its patient lookup.
  const canPickPatients = ['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST'].includes(user?.role ?? '');
  const patients = useQuery({
    queryKey: ['booking-patients', patientSearch],
    queryFn: () => apiGet<{ items: Patient[] } | Patient[]>(`/patients?search=${encodeURIComponent(patientSearch)}`, accessToken ?? undefined),
    enabled: Boolean(accessToken && canPickPatients),
  });
  const doctors = useQuery({
    queryKey: ['booking-doctors', doctorSearch],
    queryFn: () => apiGet<{ items: Doctor[] } | Doctor[]>(`/doctors`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });
  const departments = useQuery({
    queryKey: ['booking-departments', user?.hospitalId],
    queryFn: () => apiGet<{ items: Department[] } | Department[]>(`/hospitals/${user?.hospitalId}/departments`, accessToken ?? undefined),
    enabled: Boolean(accessToken && user?.hospitalId),
  });
  void departments;
  const slots = useQuery({
    queryKey: ['booking-slots', selectedDoctor, date],
    queryFn: () => apiGet<{ slots: Array<{ startsAt: string; endsAt: string }> }>(`/doctors/${selectedDoctor}/available-slots?date=${date}`, accessToken ?? undefined),
    enabled: Boolean(accessToken && selectedDoctor && date),
  });
  const history = useQuery({
    queryKey: ['booking-history'],
    queryFn: () => apiGet<{ items: Appointment[] } | Appointment[]>(`/appointments`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });

  const patientList: Patient[] = useMemo(() => {
    const data = patients.data;
    if (!data) return [];
    return Array.isArray(data) ? data : data.items;
  }, [patients.data]);

  async function book(values: z.infer<typeof bookingSchema>) {
    setError(null);
    setConfirmation(null);
    try {
      const created = await apiPost<{ id: string }>(`/appointments`, values, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
      setConfirmation(`Appointment booked: ${created.id}`);
      queryClient.invalidateQueries({ queryKey: ['booking-slots'] });
      queryClient.invalidateQueries({ queryKey: ['booking-history'] });
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Booking failed.');
    }
  }

  async function cancelAppointment(id: string) {
    setError(null);
    try {
      await apiPatch(`/appointments/${id}/cancel`, {}, accessToken ?? undefined);
      queryClient.invalidateQueries({ queryKey: ['booking-history'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cancellation failed.');
    }
  }

  const historyList: Appointment[] = useMemo(() => {
    const data = history.data;
    if (!data) return [];
    return Array.isArray(data) ? data : data.items;
  }, [history.data]);
  const slotList = slots.data?.slots ?? [];
  const selectedSlot = form.watch('startsAt');
  const emergency = form.watch('isEmergency');

  return (
    <main className="mc-booking">
      <PageHeader
        eyebrow="Scheduling"
        title="Appointments"
        description="Find the right clinician, pick a live slot, and confirm — conflict-protected on the server."
        actions={<Tabs value={tab} onChange={setTab} options={[{ value: 'book', label: 'Book' }, { value: 'history', label: 'History' }]} ariaLabel="Appointment views" />}
      />
      {tab === 'book' ? (
        <div className="mc-booking-grid">
          <Card tone="raised" entrance className="mc-booking-card">
            <h2 className="mc-card-title">Find and book</h2>
            <div className="mc-booking-search">
              <Field label="Search patients" htmlFor="patientSearch">
                <Input id="patientSearch" placeholder="Name or patient number" value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} />
              </Field>
              <Field label="Search doctors" htmlFor="doctorSearch">
                <Input id="doctorSearch" placeholder="Specialization or email" value={doctorSearch} onChange={(event) => setDoctorSearch(event.target.value)} />
              </Field>
            </div>
            <form className="mc-form" onSubmit={form.handleSubmit(book)}>
              <Field label="Patient" htmlFor="patientId" error={form.formState.errors.patientId?.message}>
                <Input id="patientId" placeholder="Patient ID" {...form.register('patientId')} />
              </Field>
              {patientList.slice(0, 4).map((patient) => (
                <button key={patient.id} type="button" className="mc-pick" onClick={() => form.setValue('patientId', patient.id)}>
                  {patient.firstName} {patient.lastName} · <span>{patient.patientNumber}</span>
                </button>
              ))}
              <Field label="Doctor" htmlFor="doctorId" error={form.formState.errors.doctorId?.message}>
                <Input id="doctorId" placeholder="Doctor ID" {...form.register('doctorId')} />
              </Field>
              {(doctors.data && 'items' in (doctors.data as object) ? (doctors.data as { items: Doctor[] }).items : []).slice(0, 4).map((doctor) => (
                <button key={doctor.id} type="button" className="mc-pick" onClick={() => { form.setValue('doctorId', doctor.id); }}>
                  {doctor.specialization} · <span>{doctor.user?.email ?? doctor.id}</span>
                </button>
              ))}
              <div className="mc-form-row">
                <Field label="Department" htmlFor="departmentId" error={form.formState.errors.departmentId?.message}>
                  <Input id="departmentId" placeholder="Department ID" {...form.register('departmentId')} />
                </Field>
                <Field label="Date" htmlFor="slotDate">
                  <Input id="slotDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                </Field>
              </div>
              <div>
                <p className="mc-field-label" id="slotLabel">Available slots</p>
                <div className="mc-slots" role="group" aria-labelledby="slotLabel">
                  {slotList.map((slot) => {
                    const selected = selectedSlot === slot.startsAt;
                    return (
                      <button
                        key={slot.startsAt}
                        type="button"
                        onClick={() => form.setValue('startsAt', slot.startsAt)}
                        aria-pressed={selected}
                        className={`mc-slot${selected ? ' mc-slot-selected' : ''}`}
                      >
                        {new Date(slot.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </button>
                    );
                  })}
                  {selectedDoctor && slotList.length === 0 && !slots.isLoading && <p className="mc-muted-text">No open slots for this day.</p>}
                  {slots.isLoading && <p className="mc-muted-text">Checking live availability…</p>}
                </div>
                {form.formState.errors.startsAt && <p className="mc-field-error" role="alert">{form.formState.errors.startsAt.message}</p>}
              </div>
              <Field label="Reason (optional)" htmlFor="reason">
                <Input id="reason" placeholder="Visit reason" {...form.register('reason')} />
              </Field>
              <label className={`mc-emergency${emergency ? ' mc-emergency-on' : ''}`}>
                <input type="checkbox" {...form.register('isEmergency')} />
                <span><strong>Emergency booking</strong><span>Bypasses availability · still conflict-checked.</span></span>
              </label>
              <Button size="lg" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting ? 'Booking…' : 'Confirm booking'}</Button>
            </form>
            {confirmation && <p role="status" className="mc-status-ok">{confirmation}</p>}
            {error && <p role="alert" className="mc-status-error">{error}</p>}
          </Card>
          <Card tone="default" entrance entranceDelay={0.06} className="mc-booking-card">
            <h2 className="mc-card-title">Today&apos;s signal</h2>
            <p className="mc-muted-text">Slots are generated from live weekly availability minus booked appointments. Emergency requests bypass the grid but never bypass conflict protection.</p>
            <ul className="mc-legend">
              <li><span className="mc-slot mc-slot-demo" /> Available</li>
              <li><span className="mc-slot mc-slot-selected mc-slot-demo" /> Selected</li>
            </ul>
          </Card>
        </div>
      ) : (
        <Card tone="default" entrance className="mc-booking-card">
          <h2 className="mc-card-title">Appointment history</h2>
          {history.isLoading && <LoadingSkeleton rows={4} />}
          {!history.isLoading && historyList.length === 0 && <StateCard title="No appointments yet" message="Booked visits will appear here with live status." icon="◐" />}
          {historyList.length > 0 && (
            <DataTable
              columns={[
                { key: 'when', header: 'When', render: (appointment: Appointment) => new Date(appointment.startsAt).toLocaleString() },
                { key: 'status', header: 'Status', render: (appointment: Appointment) => <StatusBadge status={appointment.status} /> },
                { key: 'action', header: 'Action', align: 'right', render: (appointment: Appointment) => <Button variant="outline" size="sm" onClick={() => cancelAppointment(appointment.id)}>Cancel</Button> },
              ]}
              rows={historyList.slice(0, 20)}
              keyOf={(appointment) => appointment.id}
              emptyTitle="No appointments yet"
              emptyMessage="Booked visits will appear here with live status."
            />
          )}
        </Card>
      )}
      <style jsx>{`
        .mc-booking { display: grid; gap: 20px; }
        .mc-booking-grid { display: grid; gap: 14px; grid-template-columns: 1.35fr 0.65fr; align-items: start; }
        .mc-booking-card { padding: 22px; }
        .mc-card-title { margin: 0 0 14px; font-size: 1.05rem; }
        .mc-booking-search { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
        .mc-form { display: grid; gap: 12px; margin-top: 12px; }
        .mc-form-row { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
        .mc-pick { display: block; width: 100%; text-align: left; font-size: 0.82rem; color: var(--mc-accent-2); background: transparent; border: 0; padding: 2px 0; font-weight: 600; }
        .mc-pick span { color: var(--mc-text-faint); font-weight: 500; }
        .mc-field-label { display: block; font-size: 0.76rem; font-weight: 650; color: var(--mc-text-muted); margin-bottom: 8px; }
        .mc-slots { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
        .mc-slot { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 1px solid var(--mc-border); background: color-mix(in srgb, var(--mc-surface-2) 48%, transparent); color: var(--mc-text); border-radius: 11px; padding: 9px 6px; font-size: 0.8rem; font-weight: 700; transition: all 140ms ease; }
        .mc-slot:hover { border-color: var(--mc-border-strong); transform: translateY(-1px); }
        .mc-slot-selected { border-color: transparent; color: #fff; background: linear-gradient(135deg, #4c6dff, #22d3ee); box-shadow: var(--mc-glow); }
        .mc-slot-demo { width: 72px; text-align: center; pointer-events: none; }
        .mc-emergency { display: flex; gap: 10px; align-items: flex-start; border: 1px dashed var(--mc-border-strong); border-radius: 12px; padding: 11px 12px; font-size: 0.82rem; }
        .mc-emergency input { margin-top: 3px; accent-color: var(--mc-warning); }
        .mc-emergency span { display: grid; gap: 2px; }
        .mc-emergency span span { color: var(--mc-text-muted); font-size: 0.76rem; }
        .mc-emergency-on { border-color: var(--mc-warning); background: color-mix(in srgb, var(--mc-warning) 9%, transparent); }
        .mc-legend { list-style: none; margin: 14px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 14px; font-size: 0.78rem; color: var(--mc-text-muted); min-width: 0; }
        .mc-legend li { display: flex; align-items: center; gap: 8px; min-width: 0; }
        .mc-status-ok { border: 1px solid color-mix(in srgb, var(--mc-success) 34%, transparent); background: color-mix(in srgb, var(--mc-success) 10%, transparent); color: var(--mc-success); border-radius: 12px; padding: 10px 12px; font-size: 0.84rem; }
        .mc-status-error { border: 1px solid color-mix(in srgb, var(--mc-danger) 36%, transparent); background: color-mix(in srgb, var(--mc-danger) 10%, transparent); color: var(--mc-danger); border-radius: 12px; padding: 10px 12px; font-size: 0.84rem; }
        .mc-muted-text { color: var(--mc-text-muted); font-size: 0.84rem; }
        @media (max-width: 1023px) { .mc-booking-grid { grid-template-columns: minmax(0, 1fr); } }
        @media (max-width: 640px) { .mc-booking-card { padding: 16px; } .mc-booking-search, .mc-form-row { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </main>
  );
}
