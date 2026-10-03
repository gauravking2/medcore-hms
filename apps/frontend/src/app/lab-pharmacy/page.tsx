'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { Field, Input } from '../../components/ui/input';
import { DataTable, Tabs } from '../../components/ui/collections';
import { ErrorCard, LoadingSkeleton, PageHeader, StateCard, StatusBadge } from '../../components/ui/states';
import { ApiError, apiGet, apiPatch, apiPost } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';

interface LabOrder {
  id: string;
  status: string;
  abnormalFlag?: string | null;
  labTest?: { name: string; code: string };
}

interface Medicine {
  id: string;
  name: string;
  sku: string;
}

interface Batch {
  id: string;
  batchNumber: string;
  quantity: string | number;
  expiryDate: string;
  quarantined: boolean;
  medicine?: { name: string };
}

const orderSchema = z.object({ medicalRecordId: z.string().min(1), labTestId: z.string().min(1) });
const resultSchema = z.object({ resultNumeric: z.coerce.number().optional(), resultValue: z.string().optional(), resultNotes: z.string().max(2048).optional() });
const dispenseSchema = z.object({ prescriptionId: z.string().min(1), medicineId: z.string().min(1), quantity: z.coerce.number().positive() });

export default function LabPharmacyPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<'lab' | 'pharmacy'>('lab');
  const orderForm = useForm<z.infer<typeof orderSchema>>({ resolver: zodResolver(orderSchema) });
  const resultForm = useForm<z.infer<typeof resultSchema>>({ resolver: zodResolver(resultSchema) });
  const dispenseForm = useForm<z.infer<typeof dispenseSchema>>({ resolver: zodResolver(dispenseSchema) });
  const [resultOrderId, setResultOrderId] = useState('');

  const orders = useQuery({
    queryKey: ['lab-orders'],
    queryFn: () => apiGet<{ items: LabOrder[] } | LabOrder[]>(`/lab-orders`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });
  const medicines = useQuery({
    queryKey: ['medicines'],
    queryFn: () => apiGet<{ items: Medicine[] } | Medicine[]>(`/medicines`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });
  const inventory = useQuery({
    queryKey: ['inventory'],
    queryFn: () => apiGet<{ items: Batch[] } | Batch[]>(`/inventory`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });
  const lowStock = useQuery({
    queryKey: ['low-stock'],
    queryFn: () => apiGet<Array<{ medicine: Medicine; total: number }>>(`/pharmacy/low-stock`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });
  const expiring = useQuery({
    queryKey: ['expiring'],
    queryFn: () => apiGet<Batch[]>(`/pharmacy/expiring?withinDays=30`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });

  function itemsOf<T>(data: { items: T[] } | T[] | undefined): T[] {
    if (!data) return [];
    return Array.isArray(data) ? data : data.items;
  }

  async function createOrder(values: z.infer<typeof orderSchema>) {
    setError(null);
    try {
      await apiPost(`/lab-orders`, values, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
      queryClient.invalidateQueries({ queryKey: ['lab-orders'] });
      setStatus('Lab order created.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Order failed.');
    }
  }

  async function advanceOrder(id: string, next: string) {
    setError(null);
    try {
      await apiPatch(`/lab-orders/${id}/status`, { status: next }, accessToken ?? undefined);
      queryClient.invalidateQueries({ queryKey: ['lab-orders'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Status update failed.');
    }
  }

  async function approveOrder(id: string) {
    setError(null);
    try {
      await apiPost(`/lab-orders/${id}/approve`, {}, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
      queryClient.invalidateQueries({ queryKey: ['lab-orders'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Approval failed.');
    }
  }

  async function uploadResult(values: z.infer<typeof resultSchema>) {
    setError(null);
    try {
      await apiPatch(`/lab-orders/${resultOrderId}/result`, values, accessToken ?? undefined);
      queryClient.invalidateQueries({ queryKey: ['lab-orders'] });
      setStatus('Result uploaded with automatic range flagging.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed.');
    }
  }

  async function dispense(values: z.infer<typeof dispenseSchema>) {
    setError(null);
    try {
      await apiPost(`/pharmacy/prescriptions/${values.prescriptionId}/dispense`, { medicineId: values.medicineId, quantity: values.quantity }, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setStatus('Dispensed via FIFO from eligible batches.');
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Dispense failed.');
    }
  }

  return (
    <main className="mc-lab">
      <PageHeader
        eyebrow="Diagnostics & dispensary"
        title="Laboratory & pharmacy"
        description="Status-pipelined lab queue with automatic range flags, plus FIFO inventory with expiry and quarantine protection."
        actions={<Tabs value={tab} onChange={setTab} ariaLabel="Lab and pharmacy views" options={[{ value: 'lab', label: 'Lab queue' }, { value: 'pharmacy', label: 'Pharmacy' }]} />}
      />
      {tab === 'lab' ? (
        <div className="mc-lab-grid">
          <Card tone="raised" entrance className="mc-lab-card">
            <h2 className="mc-card-title">Work queue</h2>
            <form className="mc-inline-form" onSubmit={orderForm.handleSubmit(createOrder)}>
              <Field label="Medical record ID" htmlFor="labRecordId">
                <Input id="labRecordId" placeholder="Medical record ID" {...orderForm.register('medicalRecordId')} />
              </Field>
              <Field label="Lab test ID" htmlFor="labTestId">
                <Input id="labTestId" placeholder="Lab test ID" {...orderForm.register('labTestId')} />
              </Field>
              <Button>Create order</Button>
            </form>
            {orders.isLoading && <LoadingSkeleton rows={4} />}
            {!orders.isLoading && itemsOf<LabOrder>(orders.data).length === 0 && <StateCard title="Queue clear" message="New doctor orders will stream into this pipeline." icon="⬡" />}
            <ul className="mc-pipeline">
              {itemsOf<LabOrder>(orders.data).slice(0, 15).map((order, index) => (
                <li key={order.id} className={`mc-pipe${order.abnormalFlag && order.abnormalFlag !== 'NORMAL' ? ' mc-pipe-abnormal' : ''}`}>
                  <div className="mc-pipe-head">
                    <span className="mc-pipe-index">{String(index + 1).padStart(2, '0')}</span>
                    <strong>{order.labTest?.name ?? order.id.slice(0, 8)}</strong>
                    <StatusBadge status={order.status} />
                  </div>
                  {order.abnormalFlag && <p className="mc-pipe-flag">Flag: {order.abnormalFlag}</p>}
                  <div className="mc-pipe-actions">
                    {['SAMPLE_COLLECTED', 'PROCESSING'].map((next) => (
                      <Button key={next} variant="outline" size="sm" onClick={() => advanceOrder(order.id, next)}>{next.replace(/_/g, ' ')}</Button>
                    ))}
                    <Button variant="ghost" size="sm" onClick={() => { setResultOrderId(order.id); }}>Result</Button>
                    <Button variant="secondary" size="sm" onClick={() => approveOrder(order.id)}>Approve</Button>
                  </div>
                </li>
              ))}
            </ul>
            <form className="mc-result-form" onSubmit={resultForm.handleSubmit(uploadResult)}>
              <p className="mc-field-label">Upload result {resultOrderId ? `for ${resultOrderId.slice(0, 8)}` : '(select an order)'}</p>
              <div className="mc-result-grid">
                <Field label="Numeric value" htmlFor="resultNumeric">
                  <Input id="resultNumeric" type="number" step="0.01" placeholder="Numeric value" {...resultForm.register('resultNumeric')} />
                </Field>
                <Field label="Text value" htmlFor="resultValue">
                  <Input id="resultValue" placeholder="Text value" {...resultForm.register('resultValue')} />
                </Field>
                <Field label="Notes" htmlFor="resultNotes">
                  <Input id="resultNotes" placeholder="Notes" {...resultForm.register('resultNotes')} />
                </Field>
              </div>
              <Button variant="outline" disabled={!resultOrderId}>Upload result</Button>
            </form>
          </Card>
          <Card tone="default" entrance entranceDelay={0.06} className="mc-lab-card">
            <h2 className="mc-card-title">Reading the queue</h2>
            <ul className="mc-legend-list">
              <li><StatusBadge status="ORDERED" /> Sample not yet collected</li>
              <li><StatusBadge status="PROCESSING" /> Analyzer running</li>
              <li><StatusBadge status="RESULT_UPLOADED" /> Awaiting approval</li>
              <li><StatusBadge status="APPROVED" /> Visible to patient</li>
            </ul>
            <p className="mc-fineprint">Abnormal flags derive automatically from reference ranges. Patients only see APPROVED reports.</p>
          </Card>
        </div>
      ) : (
        <div className="mc-lab-grid mc-lab-grid-pharmacy">
          <Card tone="raised" entrance className="mc-lab-card">
            <h2 className="mc-card-title">Inventory intelligence</h2>
            <div className="mc-stock-kpis">
              <div className="mc-stock-kpi"><p className="mc-meta-label">Low stock</p><p className="mc-kpi-number">{(lowStock.data ?? []).length}</p></div>
              <div className="mc-stock-kpi"><p className="mc-meta-label">Expiring ≤30d</p><p className="mc-kpi-number">{(expiring.data ?? []).length}</p></div>
              <div className="mc-stock-kpi"><p className="mc-meta-label">Batches</p><p className="mc-kpi-number">{itemsOf<Batch>(inventory.data).length}</p></div>
            </div>
            <DataTable
              columns={[
                { key: 'batch', header: 'Batch', render: (batch: Batch) => (<><strong>{batch.medicine?.name ?? batch.batchNumber}</strong><span className="mc-row-sub">{batch.batchNumber}</span></>) },
                { key: 'qty', header: 'Qty', align: 'right', render: (batch: Batch) => String(batch.quantity) },
                { key: 'expiry', header: 'Expiry', align: 'right', render: (batch: Batch) => new Date(batch.expiryDate).toLocaleDateString() },
                { key: 'state', header: 'State', align: 'right', render: (batch: Batch) => <StatusBadge status={batch.quarantined ? 'SUSPENDED' : 'ACTIVE'} /> },
              ]}
              rows={itemsOf<Batch>(inventory.data).slice(0, 12)}
              keyOf={(batch) => batch.id}
              emptyTitle="No batches"
              emptyMessage="Received inventory will appear here with FIFO ordering."
            />
          </Card>
          <Card tone="default" entrance entranceDelay={0.06} className="mc-lab-card">
            <h2 className="mc-card-title">Dispense · FIFO protected</h2>
            <form className="mc-form" onSubmit={dispenseForm.handleSubmit(dispense)}>
              <Field label="Prescription ID" htmlFor="rxId">
                <Input id="rxId" placeholder="Prescription ID" {...dispenseForm.register('prescriptionId')} />
              </Field>
              <Field label="Medicine ID" htmlFor="medId">
                <Input id="medId" placeholder="Medicine ID" {...dispenseForm.register('medicineId')} />
              </Field>
              <Field label="Quantity" htmlFor="rxQty">
                <Input id="rxQty" type="number" step="0.01" placeholder="Quantity" {...dispenseForm.register('quantity')} />
              </Field>
              <Button>Dispense oldest eligible batch first</Button>
            </form>
            <ul className="mc-mini-list">
              {itemsOf<Medicine>(medicines.data).slice(0, 5).map((medicine) => <li key={medicine.id}>{medicine.name} · <span>{medicine.sku}</span></li>)}
            </ul>
          </Card>
        </div>
      )}
      {status && <p role="status" className="mc-status-ok">{status}</p>}
      {error && <ErrorCard message={error} />}
      <style jsx>{`
        .mc-lab { display: grid; gap: 18px; }
        .mc-lab-grid { display: grid; gap: 14px; grid-template-columns: 1.35fr 0.65fr; align-items: start; }
        .mc-lab-grid-pharmacy { grid-template-columns: 1.2fr 0.8fr; }
        .mc-lab-card { padding: 20px; }
        .mc-card-title { margin: 0 0 12px; font-size: 1.02rem; }
        .mc-inline-form { display: grid; gap: 10px; grid-template-columns: 1fr 1fr auto; align-items: end; margin-bottom: 14px; }
        .mc-pipeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
        .mc-pipe { border: 1px solid var(--mc-border); border-radius: 10px; padding: 13px; overflow: hidden; background: color-mix(in srgb, var(--mc-surface-2) 38%, transparent); min-width: 0; overflow-wrap: break-word; }
        .mc-pipe-abnormal { border-color: color-mix(in srgb, var(--mc-danger) 42%, transparent); background: color-mix(in srgb, var(--mc-danger) 7%, transparent); }
        .mc-pipe-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .mc-pipe-index { font-family: var(--mc-font-mono); font-size: 0.72rem; color: var(--mc-text-faint); flex: none; }
        .mc-pipe-head strong { font-size: 0.88rem; min-width: 0; overflow-wrap: break-word; }
        .mc-pipe-head .mc-badge, .mc-pipe-head > span:last-child { margin-left: auto; }
        .mc-pipe-flag { margin: 8px 0 0; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.05em; color: var(--mc-danger); }
        .mc-pipe-actions { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
        .mc-result-form { border-top: 1px solid var(--mc-border); margin-top: 14px; padding-top: 14px; display: grid; gap: 10px; }
        .mc-result-grid { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .mc-legend-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; font-size: 0.84rem; color: var(--mc-text-muted); }
        .mc-legend-list li { display: flex; align-items: center; gap: 10px; }
        .mc-stock-kpis { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 14px; }
        .mc-stock-kpi { border: 1px solid var(--mc-border); border-radius: 10px; overflow: hidden; padding: 12px; background: color-mix(in srgb, var(--mc-surface-2) 42%, transparent); }
        .mc-stock-kpi .mc-kpi-number { font-size: 1.5rem; }
        .mc-form { display: grid; gap: 12px; }
        .mc-mini-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 7px; font-size: 0.82rem; color: var(--mc-text-muted); }
        .mc-mini-list span { color: var(--mc-text-faint); }
        .mc-status-ok { border: 1px solid color-mix(in srgb, var(--mc-success) 34%, transparent); background: color-mix(in srgb, var(--mc-success) 10%, transparent); color: var(--mc-success); border-radius: 12px; padding: 10px 12px; font-size: 0.84rem; }
        .mc-row-sub { display: block; font-size: 0.72rem; color: var(--mc-text-faint); }
        .mc-fineprint { margin: 12px 0 0; font-size: 0.74rem; color: var(--mc-text-faint); }
        @media (max-width: 1023px) { .mc-lab-grid, .mc-lab-grid-pharmacy { grid-template-columns: minmax(0, 1fr); } }
        @media (max-width: 640px) { .mc-lab-card { padding: 16px; } .mc-inline-form, .mc-result-grid, .mc-stock-kpis { grid-template-columns: minmax(0, 1fr); } }
      `}</style>
    </main>
  );
}
