@echo off
set DATABASE_URL=postgresql://medcore:change-me-locally@localhost:5432/medcore?schema=public
set REDIS_URL=redis://localhost:6379
set JWT_SECRET=local-only-change-this-secret-32-characters
set BACKEND_PORT=3001
set FRONTEND_URL=http://localhost:3000
set CORS_ORIGINS=http://localhost:3000
set COOKIE_SECURE=false
cd /d "%~dp0"
node dist/main.js