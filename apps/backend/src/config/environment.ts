import { z } from 'zod';

const isTest = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  BACKEND_PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().optional(),
  COOKIE_SECURE: z.enum(['true', 'false', 'auto']).default('auto'),
  EMAIL_PROVIDER: z.enum(['dev', 'smtp']).default('dev').describe('Notification provider selector (password resets are dev-outbox only).').optional(),
  SMS_PROVIDER: z.enum(['dev', 'twilio']).default('dev').describe('Notification provider selector (no SMS verification flow).').optional(),
  PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

let cached: AppEnvironment | null = null;

export function getEnvironment(environment: NodeJS.ProcessEnv = process.env): AppEnvironment {
  if (cached) return cached;
  if (isTest) {
    environment = {
      DATABASE_URL: 'postgresql://medcore:change-me-locally@localhost:5433/medcore?schema=public',
      REDIS_URL: 'redis://localhost:6380',
      JWT_SECRET: 'local-only-change-this-secret-32-characters',
      ...environment,
    };
  }
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(`Invalid environment: ${result.error.message}`);
  }
  cached = result.data;
  return result.data;
}

export function validateEnvironment(environment: NodeJS.ProcessEnv = process.env): AppEnvironment {
  cached = null;
  return getEnvironment(environment);
}

export function resetEnvironmentCache() {
  cached = null;
}
