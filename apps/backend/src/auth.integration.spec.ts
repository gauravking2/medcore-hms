import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { hashPassword, isBcryptHash } from './auth/crypto.util';
import { PrismaService } from './prisma/prisma.service';
import { RedisService } from './redis/redis.service';

const HOSPITAL_SLUG = 'northstar-demo';

function cookiesOf(response: { headers: Record<string, unknown> }): string[] {
  const raw = response.headers['set-cookie'];
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') return [raw];
  return [];
}

describe('Phase 3 auth integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  let accessToken = '';
  let deviceId = 'device-a';
  const runId = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  function scopedEmail(tag: string) {
    return `phase3-${runId}-${tag}@example.test`;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api', { exclude: ['health'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('1. registration succeeds', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: scopedEmail('register'), password: 'Str0ng!Pass1', role: 'PATIENT', hospitalSlug: HOSPITAL_SLUG })
      .expect(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.email).toBe(scopedEmail('register'));
    expect(response.body.data.passwordHash).toBeUndefined();
  });

  it('2. duplicate registration fails', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: scopedEmail('register'), password: 'Str0ng!Pass1', role: 'PATIENT', hospitalSlug: HOSPITAL_SLUG })
      .expect(409);
  });

  it('3. password is bcrypt hashed with cost 12', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: scopedEmail('register') } });
    expect(user.passwordHash).not.toContain('Str0ng!Pass1');
    expect(isBcryptHash(user.passwordHash)).toBe(true);
    expect(await hashPassword('verify-cost-check')).toMatch(/^\$2[aby]\$12\$/);
  });

  it('4. login succeeds and 6. access token is issued', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: scopedEmail('register'), password: 'Str0ng!Pass1', deviceId })
      .expect(200);
    expect(response.body.data.accessToken).toBeDefined();
    expect(response.body.data.passwordHash).toBeUndefined();
    const cookies = cookiesOf(response);
    expect(cookies.join(';')).toContain('refresh_token=');
    expect(cookies.join(';').toLowerCase()).toContain('httponly');
    accessToken = response.body.data.accessToken;
    deviceId = response.body.data.deviceId;
  });

  it('5. invalid credentials fail', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: scopedEmail('register'), password: 'Wr0ng!Pass9' })
      .expect(401);
  });

  it('7-8. refresh token works and rotates', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: scopedEmail('register'), password: 'Str0ng!Pass1', deviceId: 'device-rotate' })
      .expect(200);
    const firstCookie = cookiesOf(login).find((cookie) => cookie.startsWith('refresh_token='));
    const firstToken = firstCookie?.split(';')[0].split('=')[1] ?? '';
    expect(firstToken.length).toBeGreaterThan(32);

    const rotated = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${firstToken}`])
      .send({ deviceId: 'device-rotate' })
      .expect(200);
    const secondCookie = cookiesOf(rotated).find((cookie) => cookie.startsWith('refresh_token='));
    const secondToken = secondCookie?.split(';')[0].split('=')[1] ?? '';
    expect(secondToken).not.toBe(firstToken);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${firstToken}`])
      .send({ deviceId: 'device-rotate' })
      .expect(401);
  });

  it('10. logout revokes session', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: scopedEmail('register'), password: 'Str0ng!Pass1', deviceId: 'device-logout' })
      .expect(200);
    const cookie = cookiesOf(login).find((c) => c.startsWith('refresh_token='));
    const token = cookie?.split(';')[0].split('=')[1] ?? '';
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .set('Cookie', [`refresh_token=${token}`])
      .send({ deviceId: 'device-logout' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .set('Cookie', [`refresh_token=${token}`])
      .send({ deviceId: 'device-logout' })
      .expect(401);
  });

  it('11. removed OTP endpoints return 404', async () => {
    await request(app.getHttpServer()).post('/api/auth/request-email-otp').send({ email: scopedEmail('register') }).expect(404);
    await request(app.getHttpServer()).post('/api/auth/verify-email').send({ email: scopedEmail('register'), otp: '123456' }).expect(404);
    await request(app.getHttpServer()).post('/api/auth/request-phone-otp').send({ phone: '+15550001111' }).expect(404);
    await request(app.getHttpServer()).post('/api/auth/verify-phone-public').send({ phone: '+15550001111', otp: '123456' }).expect(404);
  });

  it('14. password reset valid case; 15. expired/invalid rejected', async () => {
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: scopedEmail('register') }).expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ email: scopedEmail('register'), token: '0'.repeat(64), newPassword: 'N3w!Strong2' })
      .expect(400);
    const storedRaw = await redis.get(`pw-reset:${scopedEmail('register')}`);
    expect(storedRaw).toBeTruthy();
    const storedValue = storedRaw as string;
    const storedHash = (JSON.parse(storedValue) as { hash: string }).hash;
    expect(storedHash).toHaveLength(64);
    const resettableEmail = scopedEmail('resettable');
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: resettableEmail, password: 'Str0ng!Pass1', role: 'PATIENT', hospitalSlug: HOSPITAL_SLUG })
      .expect(201);
    await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: resettableEmail }).expect(200);
    const plainToken = await redis.get(`pw-reset:${resettableEmail}:plain`);
    expect(plainToken).toBeTruthy();
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ email: resettableEmail, token: plainToken as string, newPassword: 'N3w!StrongPass2' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: resettableEmail, password: 'N3w!StrongPass2' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ email: resettableEmail, token: plainToken as string, newPassword: 'An0ther!Strong3' })
      .expect(400);
  });

  it('16. unauthenticated request is rejected', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
  });

  it('17. unauthorized role is rejected; 20. no secrets leak', async () => {
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(me.body.data.email).toBe(scopedEmail('register'));
    expect(JSON.stringify(me.body)).not.toContain('passwordHash');
    expect(JSON.stringify(me.body)).not.toContain('refresh_token');
    await request(app.getHttpServer()).get('/api/__phase3-probes/admin-only').set('Authorization', `Bearer ${accessToken}`).expect(403);
  });

  it('18. SUPER_ADMIN role is accepted where configured', async () => {
    const superEmail = scopedEmail('super');
    await prisma.user.create({
      data: { email: superEmail, passwordHash: await hashPassword('Sup3r!Strong1'), role: 'SUPER_ADMIN', hospitalId: null },
    });
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: superEmail, password: 'Sup3r!Strong1' }).expect(200);
    await request(app.getHttpServer()).get('/api/__phase3-probes/super-only').set('Authorization', `Bearer ${login.body.data.accessToken}`).expect(200);
    await request(app.getHttpServer()).get('/api/__phase3-probes/super-only').set('Authorization', `Bearer ${accessToken}`).expect(403);
  });

  it('19. normal user hospital context is server-derived', async () => {
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
    const hospital = await prisma.hospital.findUniqueOrThrow({ where: { slug: HOSPITAL_SLUG } });
    expect(me.body.data.hospitalId).toBe(hospital.id);
    expect(me.body.data.hospitalId).not.toBeNull();
    const other = await prisma.hospital.findFirstOrThrow({ where: { slug: { not: HOSPITAL_SLUG } } });
    expect(me.body.data.hospitalId).not.toBe(other.id);
  });

  it('20b. tenant probe rejects arbitrary hospital switching', async () => {
    const other = await prisma.hospital.findFirstOrThrow({ where: { slug: { not: HOSPITAL_SLUG } } });
    const { resolveHospitalScope } = await import('./tenant/tenant.decorator');
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`).expect(200);
    expect(() => resolveHospitalScope({ userId: me.body.data.id, role: me.body.data.role, hospitalId: me.body.data.hospitalId }, other.id)).toThrow();
  });
});
