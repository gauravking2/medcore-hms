'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { use, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Field, Input } from '../../../components/ui/input';
import { Tabs } from '../../../components/ui/collections';
import { Breadcrumbs, ErrorCard, LoadingSkeleton, PageHeader, StateCard, StatusBadge } from '../../../components/ui/states';
import { ApiError, apiGet, apiPatch, apiPost } from '../../../lib/api';
import { useAuthStore } from '../../../lib/auth-store';

interface Encounter {
  id: string;
  chiefComplaint?: string | null;
  diagnosis?: string | null;
  clinicalNotes?: string | null;
}

const encounterSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required.'),
  chiefComplaint: z.string().max(2048).optional(),
  diagnosis: z.string().max(2048).optional(),
  clinicalNotes: z.string().max(4096).optional(),
  treatmentPlan: z.string().max(4096).optional(),
});

const vitalsSchema = z.object({
  heightCm: z.coerce.number().min(30).max(250),
  weightKg: z.coerce.number().min(1).max(400),
  systolicBp: z.coerce.number().min(40).max(300).optional(),
  diastolicBp: z.coerce.number().min(20).max(200).optional(),
  pulse: z.coerce.number().min(20).max(250).optional(),
  temperatureCelsius: z.coerce.number().min(30).max(45).optional(),
  spo2: z.coerce.number().min(50).max(100).optional(),
});

const prescriptionSchema = z.object({
  medicalRecordId: z.string().min(1),
  medicineId: z.string().min(1),
  dosage: z.string().min(1),
  frequency: z.string().min(1),
  duration: z.string().min(1),
  quantity: z.coerce.number().positive().optional(),
});

export default function EncounterPage({ params }: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = use(params);
  const accessToken = useAuthStore((state) => state.accessToken);
  const queryClient = useQueryClient();
  const [recordId, setRecordId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<'encounter' | 'vitals' | 'prescription'>('encounter');
  const encounterForm = useForm<z.infer<typeof encounterSchema>>({ resolver: zodResolver(encounterSchema), defaultValues: { appointmentId } });
  const vitalsForm = useForm<z.infer<typeof vitalsSchema>>({ resolver: zodResolver(vitalsSchema) });
  const rxForm = useForm<z.infer<typeof prescriptionSchema>>({ resolver: zodResolver(prescriptionSchema) });

  const record = useQuery({
    queryKey: ['encounter', recordId],
    queryFn: () => apiGet<Encounter>(`/medical-records/${recordId}`, accessToken ?? undefined),
    enabled: Boolean(accessToken && recordId),
  });

  async function startEncounter(values: z.infer<typeof encounterSchema>) {
    setError(null);
    try {
      const created = await apiPost<{ id: string }>(`/medical-records`, values, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
      setRecordId(created.id);
      rxForm.setValue('medicalRecordId', created.id);
      setStatus(`Encounter started: ${created.id}`);
      setTab('vitals');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start encounter.');
    }
  }

  async function saveVitals(values: z.infer<typeof vitalsSchema>) {
    setError(null);
    try {
      const saved = await apiPost<{ bmi?: number }>(`/medical-records/${recordId}/vitals`, values, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
      setStatus(`Vitals saved. BMI ${saved.bmi ?? '—'}.`);
      setTab('prescription');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save vitals.');
    }
  }

  async function updateRecord(values: z.infer<typeof encounterSchema>) {
    setError(null);
    try {
      await apiPatch(`/medical-records/${recordId}`, { chiefComplaint: values.chiefComplaint, diagnosis: values.diagnosis, clinicalNotes: values.clinicalNotes }, accessToken ?? undefined);
      queryClient.invalidateQueries({ queryKey: ['encounter', recordId] });
      setStatus('Clinical update appended (history preserved).');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed.');
    }
  }

  async function createPrescription(values: z.infer<typeof prescriptionSchema>) {
    setError(null);
    try {
      const created = await apiPost<{ id: string }>(`/prescriptions`, {
        medicalRecordId: values.medicalRecordId,
        items: [{ medicineId: values.medicineId, dosage: values.dosage, frequency: values.frequency, duration: values.duration, quantity: values.quantity }],
      }, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
      setStatus(`Prescription created: ${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Prescription failed.');
    }
  }

  return (
    <main className="mc-encounter">
      <Breadcrumbs trail={[{ label: 'Appointments', href: '/appointments' }, { label: 'Encounter' }]} />
      <PageHeader
        eyebrow={`Appointment ${appointmentId.slice(0, 8)}`}
        title="Clinical encounter"
        description="Start the visit, capture vitals with automatic BMI, append notes without losing history, then build the prescription."
        meta={recordId ? <StatusBadge status="IN_PROGRESS" /> : <StatusBadge status="PENDING" />}
        actions={<Tabs value={tab} onChange={setTab} ariaLabel="Encounter sections" options={[{ value: 'encounter', label: 'Encounter' }, { value: 'vitals', label: 'Vitals' }, { value: 'prescription', label: 'Prescription' }]} />}
      />
      {(record.isLoading || recordDetailLoading(recordId)) && recordId && <LoadingSkeleton rows={2} />}
      {record.data && (
        <Card tone="glow" className="mc-summary">
          <div><p className="mc-meta-label">Record</p><p className="mc-mono">{record.data.id.slice(0, 12)}</p></div>
          <div><p className="mc-meta-label">Complaint</p><p>{record.data.chiefComplaint ?? '—'}</p></div>
          <div><p className="mc-meta-label">Diagnosis</p><p>{record.data.diagnosis ?? '—'}</p></div>
        </Card>
      )}
      {tab === 'encounter' && (
        <div className="mc-enc-grid">
          <Card tone="raised" entrance className="mc-enc-card">
            <h2 className="mc-card-title">Start encounter</h2>
            <form className="mc-form" onSubmit={encounterForm.handleSubmit(startEncounter)}>
              <Field label="Appointment ID" htmlFor="encAppt" error={encounterForm.formState.errors.appointmentId?.message}>
                <Input id="encAppt" placeholder="Appointment ID" {...encounterForm.register('appointmentId')} />
              </Field>
              <div className="mc-form-row">
                <Field label="Chief complaint" htmlFor="encComplaint"><Input id="encComplaint" placeholder="Chief complaint" {...encounterForm.register('chiefComplaint')} /></Field>
                <Field label="Diagnosis" htmlFor="encDiagnosis"><Input id="encDiagnosis" placeholder="Diagnosis" {...encounterForm.register('diagnosis')} /></Field>
              </div>
              <div className="mc-form-row">
                <Field label="Clinical notes" htmlFor="encNotes"><Input id="encNotes" placeholder="Clinical notes" {...encounterForm.register('clinicalNotes')} /></Field>
                <Field label="Treatment plan" htmlFor="encPlan"><Input id="encPlan" placeholder="Treatment plan" {...encounterForm.register('treatmentPlan')} /></Field>
              </div>
              <Button size="lg" disabled={encounterForm.formState.isSubmitting}>{encounterForm.formState.isSubmitting ? 'Starting…' : 'Start encounter'}</Button>
            </form>
          </Card>
          <Card tone="default" entrance entranceDelay={0.06} className="mc-enc-card">
            <h2 className="mc-card-title">Append clinical update</h2>
            <p className="mc-muted-text">Updates append a new history entry — prior notes are never overwritten.</p>
            <form className="mc-form" onSubmit={encounterForm.handleSubmit(updateRecord)}>
              <Button variant="outline" disabled={!recordId}>Append clinical update</Button>
            </form>
          </Card>
        </div>
      )}
      {tab === 'vitals' && (
        <Card tone="raised" entrance className="mc-enc-card">
          <h2 className="mc-card-title">Vitals · BMI auto-calculated server-side</h2>
          {!recordId && <StateCard title="Start an encounter first" message="Vitals attach to a medical record. Complete the encounter step to continue." icon="◈" />}
          <form className="mc-form" onSubmit={vitalsForm.handleSubmit(saveVitals)}>
            <div className="mc-vitals-grid">
              <Field label="Height cm" htmlFor="vHeight" error={vitalsForm.formState.errors.heightCm?.message}><Input id="vHeight" type="number" step="0.1" placeholder="Height cm" {...vitalsForm.register('heightCm')} /></Field>
              <Field label="Weight kg" htmlFor="vWeight" error={vitalsForm.formState.errors.weightKg?.message}><Input id="vWeight" type="number" step="0.1" placeholder="Weight kg" {...vitalsForm.register('weightKg')} /></Field>
              <Field label="Systolic" htmlFor="vSys"><Input id="vSys" type="number" placeholder="Systolic" {...vitalsForm.register('systolicBp')} /></Field>
              <Field label="Diastolic" htmlFor="vDia"><Input id="vDia" type="number" placeholder="Diastolic" {...vitalsForm.register('diastolicBp')} /></Field>
              <Field label="Pulse" htmlFor="vPulse"><Input id="vPulse" type="number" placeholder="Pulse" {...vitalsForm.register('pulse')} /></Field>
              <Field label="Temp °C" htmlFor="vTemp"><Input id="vTemp" type="number" step="0.1" placeholder="Temp °C" {...vitalsForm.register('temperatureCelsius')} /></Field>
              <Field label="SpO2" htmlFor="vSpo2"><Input id="vSpo2" type="number" step="0.1" placeholder="SpO2" {...vitalsForm.register('spo2')} /></Field>
            </div>
            <Button size="lg" variant="outline" disabled={!recordId || vitalsForm.formState.isSubmitting}>Save vitals</Button>
          </form>
        </Card>
      )}
      {tab === 'prescription' && (
        <Card tone="raised" entrance className="mc-enc-card">
          <h2 className="mc-card-title">Prescription builder</h2>
          <form className="mc-rx-grid" onSubmit={rxForm.handleSubmit(createPrescription)}>
            <Field label="Medical record ID" htmlFor="rxRecord" error={rxForm.formState.errors.medicalRecordId?.message}><Input id="rxRecord" placeholder="Medical record ID" {...rxForm.register('medicalRecordId')} /></Field>
            <Field label="Medicine ID" htmlFor="rxMed" error={rxForm.formState.errors.medicineId?.message}><Input id="rxMed" placeholder="Medicine ID" {...rxForm.register('medicineId')} /></Field>
            <Field label="Dosage" htmlFor="rxDosage" error={rxForm.formState.errors.dosage?.message}><Input id="rxDosage" placeholder="Dosage (500mg)" {...rxForm.register('dosage')} /></Field>
            <Field label="Frequency" htmlFor="rxFreq" error={rxForm.formState.errors.frequency?.message}><Input id="rxFreq" placeholder="Frequency (Twice daily)" {...rxForm.register('frequency')} /></Field>
            <Field label="Duration" htmlFor="rxDur" error={rxForm.formState.errors.duration?.message}><Input id="rxDur" placeholder="Duration (7 days)" {...rxForm.register('duration')} /></Field>
            <Field label="Quantity" htmlFor="rxQty"><Input id="rxQty" type="number" placeholder="Quantity" {...rxForm.register('quantity')} /></Field>
            <Button size="lg" disabled={rxForm.formState.isSubmitting}>Create prescription</Button>
          </form>
          <p className="mc-muted-text">Preview and signed PDF download are available from the prescriptions list after creation.</p>
        </Card>
      )}
      {status && <p role="status" className="mc-status-ok">{status}</p>}
      {error && <ErrorCard message={error} />}
      <style jsx>{`
        .mc-encounter { display: grid; gap: 16px; }
        .mc-summary { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 16px 18px; }
        .mc-enc-grid { display: grid; gap: 14px; grid-template-columns: 1.4fr 0.6fr; align-items: start; }
        .mc-enc-card { padding: 22px; }
        .mc-card-title { margin: 0 0 12px; font-size: 1.02rem; }
        .mc-form { display: grid; gap: 12px; }
        .mc-form-row { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
        .mc-vitals-grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .mc-rx-grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .mc-rx-grid > :last-child { grid-column: 1 / -1; }
        .mc-status-ok { border: 1px solid color-mix(in srgb, var(--mc-success) 34%, transparent); background: color-mix(in srgb, var(--mc-success) 10%, transparent); color: var(--mc-success); border-radius: 12px; padding: 10px 12px; font-size: 0.84rem; }
        .mc-muted-text { color: var(--mc-text-muted); font-size: 0.84rem; }
        @media (max-width: 1023px) { .mc-enc-grid { grid-template-columns: minmax(0, 1fr); } .mc-summary { grid-template-columns: minmax(0, 1fr); } }
        @media (max-width: 640px) { .mc-enc-card { padding: 16px; } .mc-form-row, .mc-vitals-grid, .mc-rx-grid { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </main>
  );
}

function recordDetailLoading(recordId: string): boolean {
  void recordId;
  return false;
}
