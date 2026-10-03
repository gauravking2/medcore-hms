process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://medcore:change-me-locally@localhost:5433/medcore?schema=public';
process.env.REDIS_URL ??= 'redis://localhost:6380';
process.env.JWT_SECRET ??= 'local-only-change-this-secret-32-characters';
process.env.BACKEND_PORT ??= '3001';
