import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { parseAllowedOrigins } from './config/environment';

// Production origins under test. Kept as constants (never committed secrets).
const PROD_FRONTEND = 'https://medcore-frontend-1q4k.onrender.com';

function corsOf(response: { headers: Record<string, unknown> }): Record<string, string> {
  const headers = response.headers as Record<string, string | string[]>;
  const pick = (name: string): string => {
    const value = headers[name];
    return Array.isArray(value) ? value.join(', ') : (value ?? '');
  };
  return { allowOrigin: pick('access-control-allow-origin'), allowCredentials: pick('access-control-allow-credentials') };
}

function setCookies(response: { headers: Record<string, unknown> }): string[] {
  const raw = (response.headers as Record<string, unknown>)['set-cookie'];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') return [raw];
  return [];
}

describe('Production cross-origin auth (Render frontend origin)', () => {
  let app: INestApplication;
  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const email = `xorigin-${runId}@example.test`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    // Mirror main.ts, including pasted-quote/trailing-slash tolerance.
    const origins = parseAllowedOrigins(`"${PROD_FRONTEND}/" , http://localhost:3000`, 'http://localhost:3000');
    app.enableCors({ origin: origins, credentials: true });
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('parses messy origin lists without ever allowing a wildcard', () => {
    expect(parseAllowedOrigins(`"${PROD_FRONTEND}/" , http://localhost:3000`, 'http://localhost:3000')).toEqual([
      PROD_FRONTEND,
      'http://localhost:3000',
    ]);
    expect(parseAllowedOrigins(`*, ${PROD_FRONTEND}`, 'http://localhost:3000')).toEqual([PROD_FRONTEND]);
    expect(parseAllowedOrigins(undefined, 'http://localhost:3000')).toEqual(['http://localhost:3000']);
    expect(parseAllowedOrigins('medcore-frontend-1q4k.onrender.com', 'http://localhost:3000')).toEqual([
      'https://medcore-frontend-1q4k.onrender.com',
    ]);
    expect(parseAllowedOrigins('http://localhost:3000', 'http://localhost:3000')).toEqual(['http://localhost:3000']);
  });

  it('preflight from the production frontend origin is accepted', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/auth/login')
      .set('Origin', PROD_FRONTEND)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);
    const cors = corsOf(response);
    expect(cors.allowOrigin).toBe(PROD_FRONTEND);
    expect(cors.allowCredentials).toBe('true');
  });

  it('register succeeds cross-origin without requiring a session cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('Origin', PROD_FRONTEND)
      .send({ email, password: 'X0rigin!Test1', role: 'PATIENT', hospitalSlug: 'northstar-demo' })
      .expect(201);
    expect(response.body.success).toBe(true);
    const cors = corsOf(response);
    expect(cors.allowOrigin).toBe(PROD_FRONTEND);
    expect(cors.allowCredentials).toBe('true');
    expect(setCookies(response).join(';')).not.toContain('refresh_token=');
  });

  it('register duplicate email is rejected cross-origin', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .set('Origin', PROD_FRONTEND)
      .send({ email, password: 'X0rigin!Test1', role: 'PATIENT', hospitalSlug: 'northstar-demo' })
      .expect(409);
    expect(response.body.error.code).toBe('DUPLICATE_EMAIL');
    expect(corsOf(response).allowOrigin).toBe(PROD_FRONTEND);
  });

  it('login succeeds cross-origin with the full session payload and cookie', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', PROD_FRONTEND)
      .send({ email, password: 'X0rigin!Test1' })
      .expect(200);
    expect(response.body.data.user.email).toBe(email);
    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.expiresIn).toBeDefined();
    expect(response.body.data.deviceId).toBeDefined();
    const cors = corsOf(response);
    expect(cors.allowOrigin).toBe(PROD_FRONTEND);
    expect(cors.allowCredentials).toBe('true');
    const cookies = setCookies(response).join(';');
    expect(cookies).toContain('refresh_token=');
    expect(cookies).toMatch(/httponly/i);
    expect(cookies).toContain('Path=/');
  });

  it('invalid login is rejected cross-origin as JSON', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', PROD_FRONTEND)
      .send({ email, password: 'Wrong!1234' })
      .expect(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(corsOf(response).allowOrigin).toBe(PROD_FRONTEND);
  });
});
