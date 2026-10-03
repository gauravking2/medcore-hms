'use client';

import { useQuery } from '@tanstack/react-query';
import { use } from 'react';
import { Breadcrumbs } from '../../../components/ui/states';
import { Card } from '../../../components/ui/card';
import { ErrorCard, LoadingSkeleton, PageHeader, StateCard, StatusBadge } from '../../../components/ui/states';
import { apiGet } from '../../../lib/api';
import { useAuthStore } from '../../../lib/auth-store';

interface HospitalDetails {
  id: string;
  name: string;
  slug: string;
  status: string;
  email?: string | null;
  phone?: string | null;
}

export default function HospitalDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const accessToken = useAuthStore((state) => state.accessToken);
  const hospital = useQuery({
    queryKey: ['hospital', id],
    queryFn: () => apiGet<HospitalDetails>(`/hospitals/${id}`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });
  const departments = useQuery({
    queryKey: ['hospital-departments', id],
    queryFn: () => apiGet<{ items: Array<{ id: string; name: string; code: string }> } | Array<{ id: string; name: string; code: string }>>(`/hospitals/${id}/departments`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });
  const departmentRows = Array.isArray(departments.data) ? departments.data : (departments.data?.items ?? []);

  return (
    <main className="mc-hospital">
      <Breadcrumbs trail={[{ label: 'Command', href: '/dashboard' }, { label: 'Hospital' }]} />
      <PageHeader
        eyebrow="Tenant scope"
        title={hospital.data?.name ?? 'Hospital details'}
        description={hospital.data ? `${hospital.data.slug} · ${hospital.data.email ?? 'No contact email'} · ${hospital.data.phone ?? 'No phone'}` : 'Hospital profile scoped to your authorization.'}
        meta={hospital.data ? <StatusBadge status={hospital.data.status} /> : undefined}
      />
      {hospital.isLoading && <LoadingSkeleton rows={3} />}
      {hospital.error && <ErrorCard message="Unable to load this hospital for your scope." onRetry={() => hospital.refetch()} />}
      {hospital.data && (
        <div className="mc-hospital-grid">
          <Card tone="raised" entrance className="mc-hospital-card">
            <h2 className="mc-card-title">Departments</h2>
            {departments.isLoading && <LoadingSkeleton rows={3} />}
            {!departments.isLoading && departmentRows.length === 0 && <StateCard title="No departments" message="Departments created for this hospital will appear here." icon="⬡" />}
            <ul className="mc-dept-list">
              {departmentRows.slice(0, 12).map((department) => (
                <li key={department.id}><strong>{department.name}</strong><span>{department.code}</span></li>
              ))}
            </ul>
          </Card>
          <Card tone="default" entrance entranceDelay={0.06} className="mc-hospital-card">
            <h2 className="mc-card-title">Tenant context</h2>
            <p className="mc-muted-text">All departments, doctors, patients, and billing below inherit this hospital scope server-side. Cross-hospital access is rejected.</p>
          </Card>
        </div>
      )}
      <style jsx>{`
        .mc-hospital { display: grid; gap: 16px; }
        .mc-hospital-grid { display: grid; gap: 14px; grid-template-columns: 1.3fr 0.7fr; align-items: start; }
        .mc-hospital-card { padding: 20px; }
        .mc-card-title { margin: 0 0 12px; font-size: 1.02rem; }
        .mc-dept-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .mc-dept-list li { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid var(--mc-border); border-radius: 11px; padding: 10px 12px; font-size: 0.84rem; }
        .mc-dept-list span { color: var(--mc-text-faint); font-family: var(--mc-font-mono); font-size: 0.74rem; }
        .mc-muted-text { color: var(--mc-text-muted); font-size: 0.84rem; }
        @media (max-width: 900px) { .mc-hospital-grid { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </main>
  );
}
