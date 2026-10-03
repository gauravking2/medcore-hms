import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

interface SocketUser {
  userId: string;
  role: string;
  hospitalId: string | null;
}

@Injectable()
export class NotificationsGateway {
  private readonly logger = new Logger(NotificationsGateway.name);
  private server: Server | null = null;

  constructor(private readonly jwt: JwtService) {}

  attach(server: Server): void {
    this.server = server;
    server.use((socket: Socket, next: (error?: Error) => void) => {
      try {
        const token = this.extractToken(socket);
        if (!token) return next(new Error('UNAUTHENTICATED'));
        const payload = this.jwt.verify(token) as { sub?: unknown; role?: unknown; hospitalId?: unknown; type?: unknown };
        if (typeof payload.sub !== 'string' || typeof payload.role !== 'string' || payload.type === 'refresh') {
          return next(new Error('UNAUTHENTICATED'));
        }
        const user: SocketUser = { userId: payload.sub, role: payload.role, hospitalId: typeof payload.hospitalId === 'string' ? payload.hospitalId : null };
        (socket.data as { user?: SocketUser }).user = user;
        // Private room per user: no cross-user broadcasts. Hospital room is only
        // used for staff-wide events already scoped server-side.
        void socket.join(`user:${user.userId}`);
        if (user.hospitalId) void socket.join(`hospital:${user.hospitalId}`);
        this.logger.log(`Socket connected for user ${user.userId}.`);
        next();
      } catch {
        next(new Error('UNAUTHENTICATED'));
      }
    });
    server.on('connection', (socket: Socket) => {
      socket.on('disconnect', () => {
        this.logger.log('Socket disconnected.');
      });
    });
  }

  private extractToken(socket: Socket): string | null {
    const auth = (socket.handshake.auth ?? {}) as { token?: unknown };
    if (typeof auth.token === 'string' && auth.token.length > 0) return auth.token;
    const header = socket.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
    const query = socket.handshake.query.token;
    if (typeof query === 'string' && query.length > 0) return query;
    return null;
  }

  emitToUser(userId: string, payload: Record<string, unknown>): void {
    if (!this.server) return;
    this.server.to(`user:${userId}`).emit('notification', payload);
  }
}
