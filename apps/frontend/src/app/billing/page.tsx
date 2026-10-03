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
import { ErrorCard, LoadingSkeleton, PageHeader, StateCard, StatusBadge } from '../../components/ui/states';
import { ApiError, apiBase, apiGet, apiPatch, apiPost } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';
import { useRealtimeNotifications } from '../../lib/socket';

interface InvoiceItem {
  description: string;
  quantity: string | number;
  unitPrice: string | number;
  amount: string | number;
  category: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  paymentStatus: string;
  total: string | number;
  currency: string;
  items: InvoiceItem[];
  payments?: Array<{ method: string; amount: string | number; status: string }>;
}

const paymentSchema = z.object({ amount: z.coerce.number().positive('Enter an amount.'), method: z.enum(['STRIPE_CARD', 'RAZORPAY']) });
const cashSchema = z.object({ amount: z.coerce.number().positive('Enter an amount.') });
const invoiceSchema = z.object({ appointmentId: z.string().min(1, 'Appointment ID is required.') });

export default function BillingPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [payTab, setPayTab] = useState<'online' | 'cash'>('online');
  useRealtimeNotifications();
  const paymentForm = useForm<z.infer<typeof paymentSchema>>({ resolver: zodResolver(paymentSchema), defaultValues: { method: 'STRIPE_CARD' } });
  const cashForm = useForm<z.infer<typeof cashSchema>>({ resolver: zodResolver(cashSchema) });
  const invoiceForm = useForm<z.infer<typeof invoiceSchema>>({ resolver: zodResolver(invoiceSchema) });

  const invoices = useQuery({
    queryKey: ['invoices'],
    queryFn: () => apiGet<{ items: Invoice[] } | Invoice[]>(`/invoices`, accessToken ?? undefined),
    enabled: Boolean(accessToken),
  });
  const invoiceList: Invoice[] = useMemo(() => {
    const data = invoices.data;
    if (!data) return [];
    return Array.isArray(data) ? data : data.items;
  }, [invoices.data]);
  const selected = invoiceList.find((invoice) => invoice.id === selectedId) ?? invoiceList[0];

  async function createInvoice(values: z.infer<typeof invoiceSchema>) {
    setError(null);
    try {
      await apiPost(`/invoices`, { appointmentId: values.appointmentId, autoItems: true }, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setStatus('Invoice created with server-calculated totals.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invoice creation failed.');
    }
  }

  async function finalizeInvoice(id: string) {
    setError(null);
    try {
      await apiPatch(`/invoices/${id}/finalize`, {}, accessToken ?? undefined);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Finalize failed.');
    }
  }

  async function initiatePayment(values: z.infer<typeof paymentSchema>) {
    setError(null);
    if (!selected) return;
    try {
      const result = await apiPost<{ intent: Record<string, unknown>; provider: string; mode: string }>(`/invoices/${selected.id}/payments/initiate`, values, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
      setStatus(`Payment session created (${result.provider}, ${result.mode} mode). Complete it via the provider webhook — the invoice updates only after verified confirmation.`);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Payment initiation failed.');
    }
  }

  async function recordCash(values: z.infer<typeof cashSchema>) {
    setError(null);
    if (!selected) return;
    try {
      await apiPost(`/invoices/${selected.id}/payments/cash`, values, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setStatus('Cash payment recorded at the counter.');
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : 'Cash payment failed.');
    }
  }

  if (!accessToken) {
    return (
      <main className="mc-narrow">
        <h1 className="mc-hero-title">Billing</h1>
        <a className="mc-portal-link" href="/login">Sign in to view billing →</a>
      </main>
    );
  }

  const canManage = user?.role === 'SUPER_ADMIN' || user?.role === 'HOSPITAL_ADMIN' || user?.role === 'RECEPTIONIST' || user?.role === 'ACCOUNTANT';
  const outstanding = invoiceList.filter((invoice) => invoice.paymentStatus !== 'PAID').reduce((sum, invoice) => sum + Number(invoice.total), 0);

  return (
    <main className="mc-billing">
      <PageHeader
        eyebrow="Revenue operations"
        title="Billing & payments"
        description="Server-calculated invoices, verified webhooks, and auditable cash handling. Nothing here marks payment from client input."
        actions={canManage ? <span className="mc-chip-live">Staff workspace</span> : <span className="mc-chip-live">Patient view</span>}
      />
      <div className="mc-billing-kpis">
        <Card tone="raised" className="mc-billing-kpi"><p className="mc-meta-label">Outstanding</p><p className="mc-kpi-number">{outstanding.toFixed(2)}</p></Card>
        <Card tone="default" className="mc-billing-kpi"><p className="mc-meta-label">Invoices</p><p className="mc-kpi-number">{invoiceList.length}</p></Card>
        <Card tone="default" className="mc-billing-kpi"><p className="mc-meta-label">Selected</p><p className="mc-kpi-number">{selected ? String(selected.total) : '—'}</p></Card>
      </div>
      <div className="mc-billing-grid">
        <Card tone="raised" entrance className="mc-billing-card">
          <h2 className="mc-card-title">Invoices</h2>
          {canManage && (
            <form className="mc-inline-form" onSubmit={invoiceForm.handleSubmit(createInvoice)}>
              <Field label="Appointment ID" htmlFor="appointmentId">
                <Input id="appointmentId" placeholder="Appointment ID" {...invoiceForm.register('appointmentId')} />
              </Field>
              <Button>Create invoice</Button>
            </form>
          )}
          {invoices.isLoading && <LoadingSkeleton rows={4} />}
          {invoiceList.length === 0 && !invoices.isLoading && <StateCard title="No invoices yet" message="Invoices created from appointments will appear here." icon="⬣" />}
          <ul className="mc-invoice-list">
            {invoiceList.map((invoice) => (
              <li key={invoice.id}>
                <button type="button" onClick={() => setSelectedId(invoice.id)} aria-pressed={selected?.id === invoice.id} className={`mc-invoice${selected?.id === invoice.id ? ' mc-invoice-selected' : ''}`}>
                  <span className="mc-invoice-main">
                    <strong>{invoice.invoiceNumber}</strong>
                    <span>{invoice.total} {invoice.currency}</span>
                  </span>
                  <span className="mc-invoice-badges"><StatusBadge status={invoice.status} /><StatusBadge status={invoice.paymentStatus} /></span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card tone="default" entrance entranceDelay={0.06} className="mc-billing-card">
          <h2 className="mc-card-title">Details & payment</h2>
          {!selected && <StateCard title="Select an invoice" message="Choose an invoice to inspect line items and settle payment." icon="⬣" />}
          {selected && (
            <>
              <div className="mc-invoice-detail">
                <p className="mc-invoice-number">{selected.invoiceNumber}</p>
                <DataTable
                  columns={[
                    { key: 'description', header: 'Item', render: (item: InvoiceItem) => item.description },
                    { key: 'quantity', header: 'Qty', align: 'right', render: (item: InvoiceItem) => String(item.quantity) },
                    { key: 'unit', header: 'Unit', align: 'right', render: (item: InvoiceItem) => String(item.unitPrice) },
                    { key: 'amount', header: 'Amount', align: 'right', render: (item: InvoiceItem) => String(item.amount) },
                  ]}
                  rows={selected.items}
                  keyOf={(_, index) => `${selected.id}-${index}`}
                  emptyTitle="No line items"
                  emptyMessage="Line items are generated server-side."
                />
                <p className="mc-invoice-total">Total {String(selected.total)} {selected.currency} · {selected.paymentStatus.replace(/_/g, ' ')}</p>
              </div>
              <div className="mc-action-row">
                {canManage && <Button variant="outline" size="sm" onClick={() => finalizeInvoice(selected.id)}>Finalize</Button>}
                <a className="mc-btn mc-btn-outline mc-btn-sm" href={`${apiBase()}/api/invoices/${selected.id}/receipt`}>Receipt (PDF)</a>
              </div>
              <Tabs value={payTab} onChange={setPayTab} ariaLabel="Payment methods" options={[{ value: 'online', label: 'Online · test' }, ...(canManage ? [{ value: 'cash', label: 'Cash counter' }] as const : [])]} />
              {payTab === 'online' && (
                <form className="mc-form" onSubmit={paymentForm.handleSubmit(initiatePayment)}>
                  <div className="mc-form-row">
                    <Field label="Amount" htmlFor="payAmount" error={paymentForm.formState.errors.amount?.message}>
                      <Input id="payAmount" type="number" step="0.01" placeholder="Amount" {...paymentForm.register('amount')} />
                    </Field>
                    <Field label="Method" htmlFor="payMethod">
                      <Input id="payMethod" placeholder="STRIPE_CARD or RAZORPAY" {...paymentForm.register('method')} />
                    </Field>
                  </div>
                  <Button>Create payment session</Button>
                  <p className="mc-fineprint">The invoice updates only after a verified provider webhook — never from client input.</p>
                </form>
              )}
              {payTab === 'cash' && canManage && (
                <form className="mc-form" onSubmit={cashForm.handleSubmit(recordCash)}>
                  <Field label="Cash amount" htmlFor="cashAmount" error={cashForm.formState.errors.amount?.message}>
                    <Input id="cashAmount" type="number" step="0.01" placeholder="Amount" {...cashForm.register('amount')} />
                  </Field>
                  <Button variant="outline">Record cash payment</Button>
                </form>
              )}
            </>
          )}
        </Card>
      </div>
      {status && <p role="status" className="mc-status-ok">{status}</p>}
      {error && <ErrorCard message={error} />}
      <style jsx>{`
        .mc-billing { display: grid; gap: 18px; }
        .mc-narrow { display: grid; gap: 12px; max-width: 720px; }
        .mc-hero-title { margin: 8px 0 0; font-size: clamp(1.9rem, 4vw, 2.6rem); }
        .mc-portal-link { color: var(--mc-accent-2); font-weight: 700; font-size: 0.86rem; }
        .mc-chip-live { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid var(--mc-border-strong); border-radius: 999px; padding: 7px 12px; color: var(--mc-text-muted); }
        .mc-billing-kpis { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        .mc-billing-kpi { padding: 16px; }
        .mc-billing-kpi .mc-kpi-number { font-size: 1.6rem; }
        .mc-billing-grid { display: grid; gap: 14px; grid-template-columns: 1fr 1.2fr; align-items: start; }
        .mc-billing-card { padding: 20px; }
        .mc-card-title { margin: 0 0 12px; font-size: 1.02rem; }
        .mc-inline-form { display: grid; gap: 10px; grid-template-columns: 1fr auto; align-items: end; margin-bottom: 12px; }
        .mc-invoice-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .mc-invoice { width: 100%; text-align: left; display: grid; gap: 8px; border: 1px solid var(--mc-border); border-radius: 10px; overflow: hidden; padding: 12px; background: color-mix(in srgb, var(--mc-surface-2) 40%, transparent); transition: all 140ms ease; min-width: 0; overflow-wrap: break-word; }
        .mc-invoice:hover { border-color: var(--mc-border-strong); }
        .mc-invoice-selected { border-color: transparent; background: var(--mc-nav-active); box-shadow: var(--mc-glow); }
        .mc-invoice-main { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 0.86rem; min-width: 0; }
        .mc-invoice-main > strong { min-width: 0; overflow-wrap: break-word; }
        .mc-invoice-badges { display: flex; gap: 6px; flex-wrap: wrap; }
        .mc-invoice-detail { border: 1px solid var(--mc-border); border-radius: 10px; overflow: hidden; padding: 14px; background: color-mix(in srgb, var(--mc-surface-2) 36%, transparent); min-width: 0; overflow-wrap: break-word; }
        .mc-invoice-number { margin: 0 0 10px; font-weight: 750; overflow-wrap: break-word; }
        .mc-invoice-total { margin: 12px 0 0; font-weight: 750; overflow-wrap: break-word; }
        .mc-action-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; align-items: center; }
        .mc-form { display: grid; gap: 12px; margin-top: 12px; }
        .mc-form-row { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
        .mc-status-ok { border: 1px solid color-mix(in srgb, var(--mc-success) 34%, transparent); background: color-mix(in srgb, var(--mc-success) 10%, transparent); color: var(--mc-success); border-radius: 12px; padding: 10px 12px; font-size: 0.84rem; }
        .mc-fineprint { margin: 0; font-size: 0.74rem; color: var(--mc-text-faint); }
        @media (max-width: 1023px) { .mc-billing-grid { grid-template-columns: minmax(0, 1fr); } }
        @media (max-width: 640px) { .mc-billing-kpis, .mc-form-row, .mc-inline-form { grid-template-columns: minmax(0, 1fr); } .mc-billing-card { padding: 16px; } }
      `}</style>
    </main>
  );
}
