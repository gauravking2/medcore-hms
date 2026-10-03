'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card } from '../../components/ui/card';
import { Field, Input } from '../../components/ui/input';
import { DataTable, FilterBar, FilterChip, SearchBar, Tabs } from '../../components/ui/collections';
import { ErrorCard, LoadingSkeleton, PageHeader, StateCard } from '../../components/ui/states';
import { apiGetPage } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';

type Entity = 'patients' | 'doctors' | 'medicines';

interface SearchRow {
  id: string;
  [key: string]: unknown;
}

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// Entity tabs are gated by role because the server authorizes search per
// entity: asking for a forbidden entity returned 403 on every page view.
// Mirrors InsightsService.searchEntitiesFor.
const ENTITIES_BY_ROLE: Record<string, Entity[]> = {
  SUPER_ADMIN: ['patients', 'doctors', 'medicines'],
  HOSPITAL_ADMIN: ['patients', 'doctors', 'medicines'],
  DOCTOR: ['patients', 'doctors', 'medicines'],
  NURSE: ['patients', 'doctors', 'medicines'],
  RECEPTIONIST: ['patients', 'doctors', 'medicines'],
  LAB_TECHNICIAN: ['doctors', 'medicines'],
  PHARMACIST: ['doctors', 'medicines'],
  ACCOUNTANT: ['medicines'],
};

const ENTITY_LABELS: Array<{ value: Entity; label: string }> = [
  { value: 'patients', label: 'Patients' },
  { value: 'doctors', label: 'Doctors' },
  { value: 'medicines', label: 'Medicines' },
];

export default function SearchPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const role = useAuthStore((state) => state.user?.role);
  const [term, setTerm] = useState('');
  const entities = ENTITIES_BY_ROLE[role ?? ''] ?? [];
  const [entity, setEntity] = useState<Entity>(entities[0] ?? 'medicines');
  const [page, setPage] = useState(1);
  const [specialization, setSpecialization] = useState('');
  const [dosageForm, setDosageForm] = useState('');
  const debouncedTerm = useDebounced(term, 350);

  useEffect(() => {
    setPage(1);
  }, [debouncedTerm, entity]);

  const search = useQuery({
    queryKey: ['global-search', entity, debouncedTerm, page, specialization, dosageForm],
    queryFn: () => {
      const params = new URLSearchParams({ entity, q: debouncedTerm, page: String(page), limit: '10' });
      if (entity === 'doctors' && specialization.trim()) params.set('specialization', specialization.trim());
      if (entity === 'medicines' && dosageForm.trim()) params.set('dosageForm', dosageForm.trim());
      return apiGetPage<SearchRow>(`/search?${params.toString()}`, accessToken ?? undefined);
    },
    enabled: Boolean(accessToken) && entities.includes(entity),
  });

  if (!accessToken) {
    return (
      <main className="mc-search">
        <PageHeader eyebrow="Command palette" title="Global search" description="Sign in to search across your hospital scope." />
        <StateCard title="Sign in required" message="Search runs against the server with your role scope." icon="⌕" action={<Link className="mc-btn mc-btn-primary mc-btn-sm" href="/login">Sign in to search</Link>} />
      </main>
    );
  }

  const searchPayload = search.data;
  const rows = searchPayload?.data ?? [];
  const meta = searchPayload?.meta;

  function renderRow(row: SearchRow) {
    if (entity === 'patients') return `${String(row.firstName ?? '')} ${String(row.lastName ?? '')} · ${String(row.patientNumber ?? row.id)}`;
    if (entity === 'doctors') {
      const user = row.user as { email?: string } | undefined;
      return `${String(row.specialization ?? 'Doctor')} · ${user?.email ?? String(row.id).slice(0, 8)}`;
    }
    return `${String(row.name ?? row.id)} · ${String(row.sku ?? '')}`;
  }

  return (
    <main className="mc-search">
      <PageHeader
        eyebrow="Command palette"
        title="Global search"
        description={`Role ${role ?? '—'} · every result is hospital-scoped on the server. Entity tabs are limited to what your role may read; results stream with debounced server queries.`}
      />
      <Card tone="raised" entrance className="mc-search-panel">
        <Tabs
          ariaLabel="Search entity"
          value={entity}
          onChange={(value) => setEntity(value)}
          options={ENTITY_LABELS.filter((option) => entities.includes(option.value))}
        />
        <div className="mc-search-grid">
          <SearchBar id="globalSearch" value={term} onChange={setTerm} placeholder="Type to search patients, doctors, medicines…" />
          {entity === 'doctors' && (
            <Field label="Specialisation filter" htmlFor="specializationFilter">
              <Input id="specializationFilter" placeholder="e.g. Cardiology" value={specialization} onChange={(event) => setSpecialization(event.target.value)} />
            </Field>
          )}
          {entity === 'medicines' && (
            <Field label="Form filter" htmlFor="formFilter">
              <Input id="formFilter" placeholder="e.g. Tablet" value={dosageForm} onChange={(event) => setDosageForm(event.target.value)} />
            </Field>
          )}
        </div>
        <FilterBar>
          <FilterChip active={Boolean(term || specialization || dosageForm)} onClick={() => { setTerm(''); setSpecialization(''); setDosageForm(''); }}>
            {term || specialization || dosageForm ? 'Clear search' : 'No active filters'}
          </FilterChip>
          <span className="mc-filter-meta">{meta ? `Page ${meta.page} of ${meta.totalPages} · ${meta.total} total` : 'Waiting for input…'}</span>
        </FilterBar>
      </Card>

      {entities.length === 0 && (
        <StateCard title="Search unavailable" message="Your role does not have access to the search directory." icon="⌕" />
      )}
      {search.isLoading && <LoadingSkeleton rows={5} />}
      {search.error && <ErrorCard message="Search failed. Check your filters and try again." onRetry={() => search.refetch()} />}
      {!search.isLoading && !search.error && entities.length > 0 && rows.length === 0 && (
        <StateCard title="No results" message="Try a different term or filter — search runs against the server with pagination." icon="⌕" />
      )}
      {rows.length > 0 && (
        <Card tone="default" entrance className="mc-search-results">
          <DataTable
            columns={[
              { key: 'result', header: entity === 'patients' ? 'Patient' : entity === 'doctors' ? 'Doctor' : 'Medicine', render: (row: SearchRow) => renderRow(row) },
              { key: 'id', header: 'Reference', render: (row: SearchRow) => <span className="mc-mono">{String(row.id).slice(0, 8)}</span>, align: 'right' },
            ]}
            rows={rows}
            keyOf={(row) => row.id}
            emptyTitle="No results"
            emptyMessage="Try a different term or filter."
          />
          {meta && (
            <div className="mc-pagination">
              <span>Page {meta.page} of {meta.totalPages} · {meta.total} total</span>
              <div className="mc-pagination-actions">
                <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="mc-btn mc-btn-outline mc-btn-sm">Previous</button>
                <button type="button" disabled={meta && page >= meta.totalPages} onClick={() => setPage((value) => value + 1)} className="mc-btn mc-btn-outline mc-btn-sm">Next</button>
              </div>
            </div>
          )}
        </Card>
      )}
      <style jsx>{`
        .mc-search { display: grid; gap: 16px; }
        .mc-search-panel { padding: 20px; display: grid; gap: 14px; }
        .mc-search-grid { display: grid; gap: 12px; grid-template-columns: 1.4fr 0.6fr; }
        .mc-filter-meta { margin-left: auto; font-size: 0.78rem; color: var(--mc-text-faint); }
        .mc-search-results { padding: 18px; }
        .mc-pagination { margin-top: 14px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; font-size: 0.82rem; color: var(--mc-text-muted); }
        .mc-pagination-actions { display: flex; gap: 8px; }
        @media (max-width: 800px) { .mc-search-grid { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </main>
  );
}
