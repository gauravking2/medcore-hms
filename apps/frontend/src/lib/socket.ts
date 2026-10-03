'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiBase } from '../lib/api';
import { useAuthStore } from './auth-store';

let socket: Socket | null = null;

export function useRealtimeNotifications(onNotification?: (payload: Record<string, unknown>) => void) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!accessToken) return;
    if (socket?.connected) return;
    const base = apiBase();
    socket = io(base, { path: '/socket.io', auth: { token: accessToken }, transports: ['websocket', 'polling'] });
    socket.on('notification', (payload: Record<string, unknown>) => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-count'] });
      if (onNotification) onNotification(payload);
    });
    socket.on('connect_error', () => undefined);
    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [accessToken, queryClient, onNotification]);
}
