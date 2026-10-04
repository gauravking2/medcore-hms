import { ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from 'socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { getEnvironment, parseAllowedOrigins } from './config/environment';
import { NotificationsGateway } from './notifications/notifications.gateway';
import { NotificationsService } from './notifications/notifications.service';

async function bootstrap() {
  const env = getEnvironment();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(helmet());
  app.use(cookieParser());
  // Webhook signature verification needs the exact raw bytes; keep them while
  // still parsing JSON for every other route.
  app.use(json({
    verify: (request: IncomingMessage & { rawBody?: Buffer }, _response: ServerResponse, buffer: Buffer) => {
      request.rawBody = buffer;
    },
  }));
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  // Render-style dashboards often persist env values with pasted quotes or a
  // trailing slash; normalize so the exact production origin still matches.
  // A wildcard is never used here because credentials are enabled.
  const origins = parseAllowedOrigins(env.CORS_ORIGINS ?? env.FRONTEND_URL, 'http://localhost:3000');
  app.enableCors({ origin: origins, credentials: true });
  const swagger = new DocumentBuilder()
    .setTitle('MedCore HMS API')
    .setDescription('Authentication, RBAC, billing, notifications, and tenant-scoped hospital administration.')
    .setVersion('0.1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .addCookieAuth('refresh_token')
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api/docs', app, document);
  const reflector = app.get(Reflector);
  void reflector;
  const port = env.BACKEND_PORT;
  await app.listen(port, '0.0.0.0');
  const httpServer = app.getHttpServer() as Parameters<Server['attach']>[0];
  const io = new Server(httpServer, { path: '/socket.io', cors: { origin: origins, credentials: true } });
  const gateway = app.get(NotificationsGateway);
  gateway.attach(io);
  app.get(NotificationsService).setSocketEmitter((userId, payload) => gateway.emitToUser(userId, payload));
}
void bootstrap();
