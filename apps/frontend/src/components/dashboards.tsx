'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, StatCard } from './ui/card';
import { ErrorCard, LoadingSkeleton, SectionHeader, StateCard, StatusBadge } from './ui/states';
import { ApiError, apiGet } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';

type SeriesPoint = Record<string, string | number> & { day: string };

interface Overview {
  range: { from: string; to: string; key: string };
  revenueTotal?: number;
  appointmentTotal?: number;
  scope?: string;
  revenue?: { series: SeriesPoint[] };
  appointments?: { series: SeriesPoint[] };
  patients?: { series: SeriesPoint[]; total: number };
  doctors?: { active: number; total: number };
  beds?: { totalRooms: number; activeRooms: number; occupiedRooms: number; totalCapacity: number; note: string };
  departments?: { scope: string; departments: Array<{ departmentId: string; name: string; appointments: number; doctors: number }>; perHospital: Array<{ hospitalId: string; hospitalName: string; appointments: number }> };
  lowStock?: { lowStockMedicines: number; medicinesTracked: number };
  upcomingAppointments?: number;
  approvedReports?: number;
  unpaidInvoices?: number;
  unpaidTotal?: number;
  unreadNotifications?: number;
}

function useOverview(range: string, hospitalId: string) {
  const accessToken = useAuthStore((state) => state.accessToken);
  return useQuery({
    queryKey: ['analytics', range, hospitalId],
    queryFn: () => {
      const params = new URLSearchParams({ range });
      if (hospitalId) params.set('hospitalId', hospitalId);
      return apiGet<Overview>(`/analytics/overview?${params.toString()}`, accessToken ?? undefined);
    },
    enabled: Boolean(accessToken),
  });
}

function ChartCard({ title, hint, data, dataKey, emptyMessage, accent }: { title: string; hint?: string; data: Array<Record<string, string | number>>; dataKey: string; emptyMessage: string; accent?: string }) {
  const hasValues = data.some((row) => Number(row[dataKey] ?? 0) > 0);
  return (
    <Card tone="raised" entrance className="mc-chart-card">
      <SectionHeader title={title} hint={hint} />
      {data.length === 0 || !hasValues ? (
        <p className="mc-muted-text">{emptyMessage}</p>
      ) : (
        <div className="mc-chart-body" role="img" aria-label={`${title} chart`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id={`mc-bar-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent ?? '#5f7dff'} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={accent ?? '#22d3ee'} stopOpacity={0.55} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 5" stroke="var(--mc-border)" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--mc-text-faint)' }} axisLine={false} tickLine={false} tickFormatter={(value: string) => value.slice(5)} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--mc-text-faint)' }} axisLine={false} tickLine={false} allowDecimals={false} width={44} />
              <Tooltip
                contentStyle={{ background: 'var(--mc-bg-elevated)', border: '1px solid var(--mc-border-strong)', borderRadius: 12, fontSize: 12 }}
                labelStyle={{ color: 'var(--mc-text-muted)' }}
              />
              <Bar dataKey={dataKey} fill={`url(#mc-bar-${dataKey})`} radius={[7, 7, 3, 3]} isAnimationActive={false} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

export function AdminDashboard({ range, hospitalId }: { range: string; hospitalId: string }) {
  const overview = useOverview(range, hospitalId);
  if (overview.isLoading) return <LoadingSkeleton rows={4} />;
  if (overview.error) return <ErrorCard message={overview.error instanceof ApiError ? overview.error.message : 'Could not load analytics.'} onRetry={() => overview.refetch()} />;
  const data = overview.data;
  if (!data || !data.revenue || !data.appointments) return <StateCard title="No analytics yet" message="Once visits and payments exist, KPIs and charts will appear here." />;
  const todayRevenue = data.revenue.series[data.revenue.series.length - 1]?.total ?? 0;
  const todayAppointments = data.appointments.series[data.appointments.series.length - 1]?.count ?? 0;
  const occupancyRate = (data.beds?.totalRooms ?? 0) > 0 ? Math.round(((data.beds?.occupiedRooms ?? 0) / (data.beds?.totalRooms ?? 1)) * 100) : 0;
  return (
    <div className="mc-dash-grid">
      <div className="mc-kpi-hero">
        <StatCard label="Revenue today" value={String(todayRevenue)} hint="Settled payments in range" accent="primary" />
        <StatCard label="Appointments today" value={String(todayAppointments)} hint={`${data.appointmentTotal ?? todayAppointments} in range`} accent="info" />
        <StatCard label="Patients in range" value={String(data.patients?.total ?? 0)} hint={`${data.doctors?.active ?? 0} active doctors`} accent="success" />
        <StatCard label="Room occupancy" value={`${occupancyRate}%`} hint={`${data.beds?.occupiedRooms ?? 0}/${data.beds?.totalRooms ?? 0} rooms`} accent={occupancyRate > 85 ? 'warning' : 'success'} />
      </div>
      <div className="mc-dash-charts">
        <ChartCard title="Appointment volume (7 days)" hint="Last range · live aggregation" data={data.appointments.series} dataKey="count" emptyMessage="No appointments in this range yet." />
        <ChartCard title="Revenue trend" hint="Settled invoices only" data={data.revenue.series} dataKey="total" emptyMessage="No paid revenue in this range yet." accent="#34d399" />
      </div>
      <div className="mc-dash-panels">
        <Card tone="default" entrance className="mc-panel">
          <SectionHeader title="Department activity" hint="Appointments and staffing · 7 days" />
          {(data.departments?.departments ?? []).length === 0 && <p className="mc-muted-text">No department activity yet.</p>}
          <ul className="mc-meter-list">
            {(data.departments?.departments ?? []).map((department) => {
              const max = Math.max(1, ...(data.departments?.departments ?? []).map((item) => item.appointments));
              return (
                <li key={department.departmentId} className="mc-meter-row">
                  <div className="mc-meter-text">
                    <span className="mc-meter-name">{department.name}</span>
                    <span className="mc-meter-sub">{department.doctors} doctors</span>
                  </div>
                  <div className="mc-meter-track" role="img" aria-label={`${department.name} ${department.appointments} appointments`}>
                    <span className="mc-meter-fill" style={{ width: `${Math.round((department.appointments / max) * 100)}%` }} />
                  </div>
                  <span className="mc-mono mc-meter-value">{department.appointments}</span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card tone="default" entrance entranceDelay={0.06} className="mc-panel">
          <SectionHeader title="Operations pulse" hint="What needs attention right now" />
          <ul className="mc-pulse-list">
            <li><span>Low-stock medicines</span><strong>{data.lowStock?.lowStockMedicines ?? 0}</strong></li>
            <li><span>Medicines tracked</span><strong>{data.lowStock?.medicinesTracked ?? 0}</strong></li>
            <li><span>Total capacity</span><strong>{data.beds?.totalCapacity ?? 0}</strong></li>
          </ul>
          <p className="mc-fineprint">Room occupancy uses the Room model (no per-bed rows exist).</p>
        </Card>
      </div>
    </div>
  );
}

export function PlatformDashboard({ range, hospitalId }: { range: string; hospitalId: string }) {
  const overview = useOverview(range, hospitalId);
  if (overview.isLoading) return <LoadingSkeleton rows={3} />;
  if (overview.error) return <ErrorCard message="Could not load platform analytics." onRetry={() => overview.refetch()} />;
  const data = overview.data;
  if (!data) return <StateCard title="No platform data" message="Hospital statistics will appear here." />;
  return (
    <div className="mc-dash-grid">
      <div className="mc-kpi-hero mc-kpi-hero-3">
        <StatCard label="Platform revenue" value={String(data.revenueTotal ?? 0)} hint="Settled across hospitals" accent="primary" />
        <StatCard label="Appointments" value={String(data.appointmentTotal ?? 0)} hint="In selected range" accent="info" />
        <StatCard label="Active doctors" value={String(data.doctors?.active ?? 0)} hint="Platform-wide" accent="success" />
      </div>
      <div className="mc-dash-panels">
        <Card tone="raised" entrance className="mc-panel">
          <SectionHeader title="Appointments per hospital" hint="Last 7 days · live data" />
          <ul className="mc-meter-list">
            {(data.departments?.perHospital ?? []).map((row) => {
              const max = Math.max(1, ...(data.departments?.perHospital ?? []).map((item) => item.appointments));
              return (
                <li key={row.hospitalId} className="mc-meter-row">
                  <span className="mc-meter-name">{row.hospitalName}</span>
                  <div className="mc-meter-track" role="img" aria-label={`${row.hospitalName} ${row.appointments} appointments`}>
                    <span className="mc-meter-fill" style={{ width: `${Math.round((row.appointments / max) * 100)}%` }} />
                  </div>
                  <span className="mc-mono mc-meter-value">{row.appointments}</span>
                </li>
              );
            })}
            {(data.departments?.perHospital ?? []).length === 0 && <li className="mc-muted-text">No hospital activity yet.</li>}
          </ul>
        </Card>
        {data.appointments && (
          <ChartCard title="Platform appointment volume" hint="All hospitals" data={data.appointments.series} dataKey="count" emptyMessage="No appointments in this range yet." />
        )}
      </div>
    </div>
  );
}

export function PatientDashboard() {
  const overview = useOverview('7d', '');
  if (overview.isLoading) return <LoadingSkeleton rows={2} />;
  if (overview.error) {
    if (overview.error instanceof ApiError && overview.error.code === 'NO_PATIENT_PROFILE') {
      return (
        <StateCard
          title="No patient profile linked"
          message="This account is not linked to a patient record yet. Ask reception to create your patient profile (or book via Appointments so one is created), then reload."
          icon="◎"
          action={<a className="mc-btn mc-btn-outline mc-btn-sm" href="/appointments">Go to Appointments</a>}
        />
      );
    }
    return <ErrorCard message="Could not load your dashboard." onRetry={() => overview.refetch()} />;
  }
  const data = overview.data;
  if (!data || data.scope !== 'patient') return <StateCard title="No summary" message="Your personal summary will appear here." />;
  return (
    <div className="mc-kpi-hero">
      <StatCard label="Upcoming appointments" value={String(data.upcomingAppointments ?? 0)} hint="Scheduled ahead" accent="info" />
      <StatCard label="Approved reports" value={String(data.approvedReports ?? 0)} hint="Ready to review" accent="success" />
      <StatCard label="Unpaid invoices" value={`${data.unpaidInvoices ?? 0}`} hint={`Balance ${data.unpaidTotal ?? 0}`} accent={(data.unpaidInvoices ?? 0) > 0 ? 'warning' : 'success'} />
      <StatCard label="Unread notifications" value={String(data.unreadNotifications ?? 0)} hint="Live signals" accent="primary" />
    </div>
  );
}

export function StatusLine({ status }: { status: string }) {
  return <StatusBadge status={status} />;
}

export function useDashboardRange() {
  const [range, setRange] = useState('7d');
  return { range, setRange };
}
