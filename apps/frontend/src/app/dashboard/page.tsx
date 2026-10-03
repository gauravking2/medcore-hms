'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { AdminDashboard, PatientDashboard, PlatformDashboard } from '../../components/dashboards';
import { Card } from '../../components/ui/card';
import { Field, Input } from '../../components/ui/input';
import { Timeline } from '../../components/ui/collections';
import { ErrorCard, LoadingSkeleton, PageHeader, StateCard, StatusBadge } from '../../components/ui/states';
import { apiGet } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';
import './dashboard.css';

interface Appointment {
  id: string;
  startsAt: string;
  status: string;
  patient?: { firstName: string; lastName: string };
}

interface LabOrder {
  id: string;
  status: string;
  abnormalFlag?: string | null;
  labTest?: { name: string };
}

interface Prescription {
  id: string;
  issuedAt: string;
}

interface LowStockRow {
  medicine: { id: string; name: string };
  total: number;
}

interface ActivityRow {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
}

function itemsOf<T>(data: { items: T[] } | T[] | undefined): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.items;
}

function RangePicker({ range, setRange }: { range: string; setRange: (value: string) => void }) {
  return (
    <div className="mc-range" role="group" aria-label="Date range">
      {['today', '7d', '30d'].map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => setRange(key)}
          aria-pressed={range === key}
          className={`mc-range-btn${range === key ? ' mc-range-active' : ''}`}
        >
          {key === 'today' ? 'Today' : key === '7d' ? 'Last 7 days' : 'Last 30 days'}
        </button>
      ))}
    </div>
  );
}

function DoctorWorkspace({ token, hospitalId }: { token: string; hospitalId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const appointments = useQuery({
    queryKey: ['doctor-today', today],
    queryFn: () => apiGet<{ items: Appointment[] } | Appointment[]>(`/appointments?from=${today}T00:00:00&to=${today}T23:59:59`, token),
  });
  const pendingLabs = useQuery({
    queryKey: ['doctor-labs'],
    queryFn: () => apiGet<{ items: LabOrder[] } | LabOrder[]>(`/lab-orders?status=RESULT_UPLOADED`, token),
  });
  const prescriptions = useQuery({
    queryKey: ['doctor-rx'],
    queryFn: () => apiGet<{ items: Prescription[] } | Prescription[]>(`/pharmacy/prescriptions?hospitalId=${hospitalId}`, token),
    enabled: Boolean(hospitalId),
  });
  const timeline = useMemo(() => itemsOf<Appointment>(appointments.data).sort((a: Appointment, b: Appointment) => +new Date(a.startsAt) - +new Date(b.startsAt)), [appointments.data]);
  return (
    <div className="mc-work-grid">
      <Card tone="raised" entrance className="mc-work-card">
        <h3 className="mc-work-title">Today&apos;s appointments timeline</h3>
        {appointments.isLoading && <LoadingSkeleton rows={4} />}
        {appointments.error && <ErrorCard message="Could not load today's appointments." onRetry={() => appointments.refetch()} />}
        {timeline.length === 0 && !appointments.isLoading && !appointments.error && <StateCard title="No appointments today" message="Booked visits for this clinician will appear on the timeline." icon="◐" />}
        <Timeline
          items={timeline.slice(0, 12).map((appointment) => ({
            id: appointment.id,
            time: new Date(appointment.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            title: appointment.patient ? `${appointment.patient.firstName} ${appointment.patient.lastName}` : `Visit ${appointment.id.slice(0, 8)}`,
            detail: new Date(appointment.startsAt).toLocaleDateString(),
            status: appointment.status.replace(/_/g, ' '),
            accent: appointment.status === 'CONFIRMED' || appointment.status === 'IN_PROGRESS',
          }))}
        />
      </Card>
      <div className="mc-work-side">
        <Card tone="default" entrance entranceDelay={0.05} className="mc-work-card">
          <h3 className="mc-work-title">Pending lab approvals</h3>
          <p className="mc-kpi-number">{itemsOf<LabOrder>(pendingLabs.data).length}</p>
          <a className="mc-work-link" href="/lab-pharmacy">Open lab queue →</a>
        </Card>
        <Card tone="default" entrance entranceDelay={0.1} className="mc-work-card">
          <h3 className="mc-work-title">Recent prescriptions</h3>
          <ul className="mc-mini-feed">
            {itemsOf<Prescription>(prescriptions.data).slice(0, 5).map((rx) => <li key={rx.id}><span>{rx.id.slice(0, 8)}</span><span>{new Date(rx.issuedAt).toLocaleDateString()}</span></li>)}
            {itemsOf<Prescription>(prescriptions.data).length === 0 && <li className="mc-muted-text">No recent prescriptions.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function StaffWorkspace({ token, hospitalId, title, links }: { token: string; hospitalId: string; title: string; links: Array<{ href: string; label: string }> }) {
  const today = new Date().toISOString().slice(0, 10);
  const appointments = useQuery({
    queryKey: ['staff-today', today],
    queryFn: () => apiGet<{ items: Appointment[] } | Appointment[]>(`/appointments?from=${today}T00:00:00&to=${today}T23:59:59`, token),
  });
  const activity = useQuery({
    queryKey: ['activity', hospitalId],
    queryFn: () => apiGet<{ items: ActivityRow[] } | ActivityRow[]>(`/activity?hospitalId=${hospitalId}`, token),
    enabled: Boolean(hospitalId),
  });
  const labs = useQuery({
    queryKey: ['staff-labs'],
    queryFn: () => apiGet<{ items: LabOrder[] } | LabOrder[]>(`/lab-orders`, token),
  });
  return (
    <div className="mc-work-grid">
      <Card tone="raised" entrance className="mc-work-card">
        <h3 className="mc-work-title">{title} · today</h3>
        <p className="mc-kpi-number">{itemsOf<Appointment>(appointments.data).length}</p>
        <div className="mc-quick-actions">
          {links.map((link) => <a key={link.href} href={link.href} className="mc-quick-action">{link.label} →</a>)}
        </div>
        <h4 className="mc-work-subtitle">Lab queue snapshot</h4>
        <ul className="mc-mini-feed">
          {itemsOf<LabOrder>(labs.data).slice(0, 5).map((order) => (
            <li key={order.id}>
              <span>{order.labTest?.name ?? order.id.slice(0, 8)}</span>
              <span><StatusBadge status={order.status} />{order.abnormalFlag && order.abnormalFlag !== 'NORMAL' ? ` · ${order.abnormalFlag}` : ''}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card tone="default" entrance entranceDelay={0.06} className="mc-work-card">
        <h3 className="mc-work-title">Recent activity</h3>
        <ul className="mc-activity-feed">
          {itemsOf<ActivityRow>(activity.data).slice(0, 8).map((row) => (
            <li key={row.id}>
              <strong>{row.action}</strong>
              <span>{row.entityType} · {new Date(row.createdAt).toLocaleString()}</span>
            </li>
          ))}
          {itemsOf<ActivityRow>(activity.data).length === 0 && <li className="mc-muted-text">No recent activity.</li>}
        </ul>
      </Card>
    </div>
  );
}

function PharmacistWorkspace({ token, hospitalId }: { token: string; hospitalId: string }) {
  const lowStock = useQuery({
    queryKey: ['low-stock'],
    queryFn: () => apiGet<LowStockRow[]>(`/pharmacy/low-stock?hospitalId=${hospitalId}`, token),
    enabled: Boolean(hospitalId),
  });
  const expiring = useQuery({
    queryKey: ['expiring'],
    queryFn: () => apiGet<Array<{ id: string; batchNumber: string; expiryDate: string }>>(`/pharmacy/expiring?hospitalId=${hospitalId}&withinDays=30`, token),
    enabled: Boolean(hospitalId),
  });
  return (
    <div className="mc-work-grid">
      <Card tone={((lowStock.data ?? []).length > 0 ? 'glow' : 'raised') as 'glow' | 'raised'} entrance className="mc-work-card">
        <h3 className="mc-work-title">Low-stock alerts</h3>
        <p className="mc-kpi-number">{(lowStock.data ?? []).length}</p>
        <ul className="mc-mini-feed">
          {(lowStock.data ?? []).slice(0, 8).map((row) => <li key={row.medicine.id}><span>{row.medicine.name}</span><span className="mc-mono">{row.total}</span></li>)}
          {(lowStock.data ?? []).length === 0 && <li className="mc-muted-text">Stock levels look healthy.</li>}
        </ul>
      </Card>
      <Card tone="default" entrance entranceDelay={0.06} className="mc-work-card">
        <h3 className="mc-work-title">Expiring within 30 days</h3>
        <p className="mc-kpi-number">{(expiring.data ?? []).length}</p>
        <ul className="mc-mini-feed">
          {(expiring.data ?? []).slice(0, 8).map((batch) => <li key={batch.id}><span>{batch.batchNumber}</span><span>{new Date(batch.expiryDate).toLocaleDateString()}</span></li>)}
          {(expiring.data ?? []).length === 0 && <li className="mc-muted-text">Nothing expiring soon.</li>}
        </ul>
        <a className="mc-work-link" href="/lab-pharmacy">Open fulfilment queue →</a>
      </Card>
    </div>
  );
}

function AccountantWorkspace({ range, hospitalId }: { range: string; hospitalId: string }) {
  return <AdminDashboard range={range} hospitalId={hospitalId} />;
}

export default function DashboardPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const [hospitalId, setHospitalId] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [activeRange, setRangeState] = useState('7d');

  const patientLookup = useQuery({
    queryKey: ['dashboard-patient-lookup', patientSearch],
    queryFn: () => apiGet<{ items: Array<{ id: string; firstName: string; lastName: string; patientNumber: string }> } | Array<{ id: string; firstName: string; lastName: string; patientNumber: string }>>(`/search?entity=patients&q=${encodeURIComponent(patientSearch)}`, accessToken ?? undefined),
    enabled: Boolean(accessToken && patientSearch.trim().length >= 2 && ['DOCTOR', 'RECEPTIONIST', 'NURSE', 'HOSPITAL_ADMIN'].includes(user?.role ?? '')),
  });

  if (!accessToken) {
    return (
      <main className="mc-dashboard-signin">
        <p className="mc-meta-label mc-eyebrow">Workspace</p>
        <h1 className="mc-page-title">Dashboard</h1>
        <p className="mc-muted-text">Sign in to load your role workspace.</p>
        <a className="mc-portal-link" href="/login">Go to sign in →</a>
      </main>
    );
  }

  const role = user?.role ?? '';
  const scopeHospitalId = hospitalId || user?.hospitalId || '';
  const lookupItems = patientLookup.data ? (Array.isArray(patientLookup.data) ? patientLookup.data : patientLookup.data.items) : [];
  const roleTitle = role === 'SUPER_ADMIN' ? 'Platform overview' : role === 'HOSPITAL_ADMIN' ? 'Hospital overview' : role === 'DOCTOR' ? 'Doctor workspace' : role === 'PATIENT' ? 'My health summary' : `${role.charAt(0) + role.slice(1).toLowerCase()} workspace`;

  return (
    <main className="mc-dashboard">
      <PageHeader
        eyebrow={`MedCore HMS · ${role || 'Workspace'}`}
        title={roleTitle}
        description="Backend authorization applies; this layout only organizes what your role may already access."
        actions={<RangePicker range={activeRange} setRange={setRangeState} />}
      />

      {role === 'SUPER_ADMIN' && (
        <>
          <Card tone="flat" className="mc-scope-card">
            <Field label="Hospital scope (optional)" htmlFor="hospitalScope">
              <Input id="hospitalScope" placeholder="Hospital ID for scoped view" value={hospitalId} onChange={(event) => setHospitalId(event.target.value)} />
            </Field>
          </Card>
          <PlatformDashboard range={activeRange} hospitalId={scopeHospitalId} />
        </>
      )}
      {(role === 'HOSPITAL_ADMIN' || role === 'ACCOUNTANT') && <AdminDashboard range={activeRange} hospitalId={scopeHospitalId} />}
      {role === 'ACCOUNTANT' && <AccountantWorkspace range={activeRange} hospitalId={scopeHospitalId} />}
      {role === 'DOCTOR' && (
        <>
          <Card tone="flat" className="mc-scope-card">
            <Field label="Quick patient lookup" htmlFor="patientLookup" hint="Type at least 2 characters">
              <Input id="patientLookup" placeholder="Type at least 2 characters…" value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} />
            </Field>
            {patientLookup.isLoading && <p className="mc-muted-text">Searching…</p>}
            <ul className="mc-mini-feed">
              {lookupItems.slice(0, 5).map((patient) => <li key={patient.id}><span>{patient.firstName} {patient.lastName}</span><span className="mc-mono">{patient.patientNumber}</span></li>)}
              {patientSearch.trim().length >= 2 && !patientLookup.isLoading && lookupItems.length === 0 && <li className="mc-muted-text">No patients match.</li>}
            </ul>
          </Card>
          <DoctorWorkspace token={accessToken} hospitalId={scopeHospitalId} />
        </>
      )}
      {role === 'NURSE' && <StaffWorkspace token={accessToken} hospitalId={scopeHospitalId} title="Nursing operations" links={[{ href: '/encounters/new', label: 'Encounters' }, { href: '/lab-pharmacy', label: 'Lab queue' }]} />}
      {role === 'RECEPTIONIST' && <StaffWorkspace token={accessToken} hospitalId={scopeHospitalId} title="Front desk" links={[{ href: '/appointments', label: 'Schedule appointment' }, { href: '/billing', label: 'Billing' }]} />}
      {role === 'LAB_TECHNICIAN' && <StaffWorkspace token={accessToken} hospitalId={scopeHospitalId} title="Lab work queue" links={[{ href: '/lab-pharmacy', label: 'Open lab queue' }]} />}
      {role === 'PHARMACIST' && <PharmacistWorkspace token={accessToken} hospitalId={scopeHospitalId} />}
      {role === 'PATIENT' && <PatientDashboard />}

      {['SUPER_ADMIN', 'HOSPITAL_ADMIN', 'ACCOUNTANT', 'DOCTOR', 'PATIENT'].includes(role) === false && role !== 'NURSE' && role !== 'RECEPTIONIST' && role !== 'LAB_TECHNICIAN' && role !== 'PHARMACIST' && (
        <StateCard title="No workspace configured" message="No workspace is configured for this role yet." icon="◈" />
      )}
      <DashboardErrorBoundary role={role} />
    </main>
  );
}

function DashboardErrorBoundary({ role }: { role: string }) {
  const [error, setError] = useState<string | null>(null);
  void error;
  void setError;
  void role;
  return null;
}
