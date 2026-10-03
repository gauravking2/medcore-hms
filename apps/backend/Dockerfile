FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
COPY packages/types/package.json packages/types/package.json
RUN npm install
COPY . .
RUN npx prisma generate --schema apps/backend/prisma/schema.prisma && npm run build --workspace=@medcore/backend
EXPOSE 3001
CMD ["npm", "run", "start", "--workspace=@medcore/backend"]
