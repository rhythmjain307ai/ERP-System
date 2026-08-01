# ERP Backend (Phase 1)

This folder contains the Phase 1 backend scaffold for the ERP system.

Quick start (after installing dependencies and running a PostgreSQL instance):

1. Install dependencies

```bash
cd backend
npm install
```

2. Set your database URL in `.env` (copy from `.env.example`)

3. Run Prisma generate and migrate (creates schema)

```bash
npx prisma generate
npx prisma migrate dev --name init
```

4. Seed the database

```bash
node prisma/seed.js
```

5. Start the server

```bash
npm start
```

APIs are mounted under `/api/*` (e.g. `/api/customers`, `/api/invoices`).

Phase 1 implemented:
- Express server
- Prisma schema for core models
- Seed script with initial data
- Core transactional endpoints: create invoice (decrements stock), record payment (updates outstanding), create/receive purchase orders, production job progress (updates stock)
