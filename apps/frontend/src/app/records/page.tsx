'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { DataTable } from '../../components/ui/collections';
import { ErrorCard, LoadingSkeleton, PageHeader, StateCard, StatusBadge } from '../../components/ui/states';
import { apiBase, apiGet } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';

interface PrescriptionItem {
  medicine: { name: string };
  dosage: string;
  frequency: string;
  duration: string;
  quantity?: string | number | null;
  specialInstructions?: string | null;
}

interface Prescription {
  id: string;
  issuedAt: string;
  items: PrescriptionItem[];
}

interface RecordRow {
  id: string;
  recordedAt: string;
  chiefComplaint?: string | null;
  diagnosis?: string | null;
}

export default function RecordsPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const [patientId, setPatientId] = useState('');
  const [recordId, setRecordId] = useState('');

  const records = useQuery({
    queryKey: ['records-list', patientId],
    queryFn: () => apiGet<{ items: RecordRow[] } | RecordRow[]>(`/medical-records/patient/${patientId}`, accessToken ?? undefined),
    enabled: Boolean(accessToken && patientId),
  });
  const recordDetail = useQuery({
    queryKey: ['record-detail', recordId],
    queryFn: () => apiGet<RecordRow & { clinicalNotes?: string | null }>(`/medical-records/${recordId}`, accessToken ?? undefined),
    enabled: Boolean(accessToken && recordId),
  });
  const prescriptions = useQuery({
    queryKey: ['records-rx', patientId],
    queryFn: () => apiGet<{ items: Prescription[] } | Prescription[]>(`/prescriptions/patient/${patientId}`, accessToken ?? undefined),
    enabled: Boolean(accessToken && patientId && user?.role !== 'PATIENT'),
  });
  const patientPrescriptions = useQuery({
    queryKey: ['my-prescriptions'],
    queryFn: async () => {
      const me = await apiGet<{ id: string; email: string; role: string }>(`/auth/me`, accessToken ?? undefined);
      void me;
      return [] as Prescription[];
    },
    enabled: Boolean(accessToken && user?.role === 'PATIENT' && patientId),
  });
  void patientPrescriptions;

  const recordRows = Array.isArray(records.data) ? records.data : (records.data?.items ?? []);
  const rxRows = Array.isArray(prescriptions.data) ? prescriptions.data : (prescriptions.data?.items ?? []);

  return (
    <main className="mc-records">
      <PageHeader
        eyebrow="Clinical records"
        title="Records & prescriptions"
        description="Append-only encounters with encrypted diagnoses, plus signed prescription documents. Patients see only their own data."
      />
      <Card tone="raised" entrance className="mc-records-lookup">
        <div className="mc-lookup-grid">
          <label className="mc-lookup-field">
            <span className="mc-field-label">Patient ID</span>
            <input className="mc-input" value={patientId} onChange={(event) => setPatientId(event.target.value)} placeholder="Paste a patient ID in your scope" />
          </label>
          <label className="mc-lookup-field">
            <span className="mc-field-label">Record ID (optional)</span>
            <input className="mc-input" value={recordId} onChange={(event) => setRecordId(event.target.value)} placeholder="Open one record in detail" />
          </label>
        </div>
      </Card>
      <div className="mc-records-grid">
        <Card tone="default" entrance className="mc-records-card">
          <h2 className="mc-card-title">Encounters</h2>
          {!patientId && <StateCard title="Select a patient" message="Enter a patient ID in your hospital scope to load append-only encounters." icon="▤" />}
          {patientId && records.isLoading && <LoadingSkeleton rows={4} />}
          {records.error && <ErrorCard message="Could not load records for this patient or scope." onRetry={() => records.refetch()} />}
          {patientId && !records.isLoading && !records.error && (
            <DataTable
              columns={[
                { key: 'date', header: 'Recorded', render: (row: RecordRow) => new Date(row.recordedAt).toLocaleDateString() },
                { key: 'complaint', header: 'Complaint', render: (row: RecordRow) => row.chiefComplaint ?? '—' },
                { key: 'action', header: 'Open', align: 'right', render: (row: RecordRow) => <Button variant="ghost" size="sm" onClick={() => setRecordId(row.id)}>Detail</Button> },
              ]}
              rows={recordRows.slice(0, 15)}
              keyOf={(row) => row.id}
              emptyTitle="No encounters"
              emptyMessage="No medical records exist for this patient yet."
            />
          )}
          {recordDetail.data && (
            <div className="mc-record-detail">
              <p className="mc-meta-label">Selected record</p>
              <p><strong>Diagnosis:</strong> {recordDetail.data.diagnosis ?? '—'}</p>
              <p className="mc-muted-text">History is append-only; updates never delete prior entries.</p>
            </div>
          )}
        </Card>
        <Card tone="default" entrance entranceDelay={0.06} className="mc-records-card">
          <h2 className="mc-card-title">Prescriptions</h2>
          {user?.role === 'PATIENT' ? (
            <StateCard title="Use your portal records" message="Signed prescriptions and PDF downloads live under your patient records view." icon="⬣" />
          ) : (
            <>
              {!patientId && <StateCard title="Select a patient" message="Prescriptions load per patient to preserve tenant isolation." icon="⬣" />}
              {patientId && prescriptions.isLoading && <LoadingSkeleton rows={3} />}
              <ul className="mc-rx-list">
                {rxRows.slice(0, 10).map((prescription) => (
                  <li key={prescription.id} className="mc-rx">
                    <div className="mc-rx-head">
                      <strong>{prescription.id.slice(0, 8)}</strong>
                      <span>{new Date(prescription.issuedAt).toLocaleDateString()}</span>
                      <StatusBadge status="APPROVED" />
                    </div>
                    <ul className="mc-rx-items">
                      {prescription.items.map((item, index) => (
                        <li key={index}>{item.medicine.name} — {item.dosage}, {item.frequency}, {item.duration}</li>
                      ))}
                    </ul>
                    <a className="mc-portal-link" href={`${apiBase()}/api/prescriptions/${prescription.id}/pdf`}>Download signed PDF →</a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
      <style jsx>{`
        .mc-records { display: grid; gap: 16px; }
        .mc-records-lookup { padding: 18px; }
        .mc-lookup-grid { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
        .mc-lookup-field { display: grid; gap: 6px; font-size: 0.82rem; }
        .mc-records-grid { display: grid; gap: 14px; grid-template-columns: 1.15fr 0.85fr; align-items: start; }
        .mc-records-card { padding: 20px; }
        .mc-card-title { margin: 0 0 12px; font-size: 1.02rem; }
        .mc-record-detail { margin-top: 14px; border: 1px solid var(--mc-border); border-radius: 12px; padding: 12px; font-size: 0.84rem; }
        .mc-rx-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .mc-rx { border: 1px solid var(--mc-border); border-radius: 10px; padding: 13px; overflow: hidden; background: color-mix(in srgb, var(--mc-surface-2) 38%, transparent); min-width: 0; overflow-wrap: break-word; }
        .mc-rx-head { display: flex; align-items: center; gap: 10px; font-size: 0.84rem; min-width: 0; }
        .mc-rx-head span { color: var(--mc-text-muted); }
        .mc-rx-head > :last-child { margin-left: auto; }
        .mc-rx-items { margin: 8px 0; padding-left: 16px; font-size: 0.82rem; color: var(--mc-text-muted); display: grid; gap: 4px; }
        .mc-portal-link { color: var(--mc-accent-2); font-weight: 700; font-size: 0.82rem; }
        .mc-muted-text { color: var(--mc-text-muted); font-size: 0.84rem; }
        @media (max-width: 1023px) { .mc-records-grid { grid-template-columns: minmax(0, 1fr); } }
        @media (max-width: 640px) { .mc-lookup-grid { grid-template-columns: minmax(0, 1fr); } .mc-records-card { padding: 16px; } }
      `}</style>
    </main>
  );
}
