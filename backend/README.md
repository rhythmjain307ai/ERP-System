# ERP Backend API

This backend uses only `prisma/schema.prisma`. `prisma/schema.old.prisma` is not part of the application.

## Setup

```bash
cd backend
npm install
cp .env.example .env
npm run prisma:generate
npm start
```

Required environment variables:

- `DATABASE_URL`: PostgreSQL connection string for the active schema.
- `PORT`: optional HTTP port, default `4000`.
- `AUTH_TOKEN_SECRET`: secret used to verify HMAC-signed bearer tokens for write endpoints.

No migration is created or applied by this setup. Run `npm run prisma:generate` whenever the active schema changes.

## API

Successful responses use `{ "success": true, "data": ... }`. Errors use `{ "success": false, "error": { "message": "..." } }`. List endpoints accept `page`, `pageSize`, `search`, and, where applicable, `status`.

Write endpoints require `Authorization: Bearer <user-id>.<signature>`, where the signature is an HMAC-SHA256 signature of the user ID using `AUTH_TOKEN_SECRET`. The authenticated user's active role and `role_permission` records determine authorization.

Master data CRUD is available under `/api/master` for `companies`, `factories`, `departments`, `employees`, `users`, `roles`, `permissions`, `customers`, `vendors`, `item-categories`, `inventory-items`, and `warehouses`. Customer and vendor aliases are also available at `/api/customers` and `/api/vendors`.

Inventory CRUD is available under `/api/inventory/items`, `/api/inventory/warehouses`, `/api/inventory/lots`, and `/api/inventory/movements`. Stock deduction and balance posting are intentionally not performed.

Transactional creation endpoints:

- `POST /api/procurement/requisitions`
- `POST /api/procurement/purchase-orders`
- `POST /api/procurement/grns`
- `POST /api/sales/orders`
- `POST /api/sales/deliveries`
- `POST /api/sales/invoices`
- `POST /api/documents`
- `PATCH /api/documents/reviews/:id`
- `POST /api/approvals/requests`
- `POST /api/approvals/actions`

Example purchase requisition:

```json
{
  "requisition_number": "PR-1001",
  "department_id": "1",
  "items": [{ "inventory_item_id": "10", "uom": "KG", "requested_quantity": 100 }]
}
```

Example sales invoice:

```json
{
  "invoice_number": "INV-1001",
  "customer_id": "1",
  "items": [{ "inventory_item_id": "10", "description": "Steel", "uom": "KG", "quantity": 100, "unit_price": 82 }]
}
```

Purchase orders, GRNs, customer orders, and deliveries use the same `items` shape with their schema-specific parent and line fields. Document creation accepts `document_type`, `file_name`, and an optional `review` object. Approval requests calculate the next `request_version` inside a transaction.

## Deferred workflows

Stock deduction, stock balance updates, automatic approval transitions, payment allocation/posting, and accounting posting are deliberately not implemented. Future payment settlement must use `payment_allocation`; no API in this foundation treats direct invoice references on `payment` as a settlement source.

## Tests

```bash
npm test
```

The test command uses Node's test directory discovery and does not depend on shell glob expansion. Basic authentication and routing tests run without a database. To run the complete integration suite, use a dedicated PostgreSQL database and set `TEST_DATABASE_URL`:

```bash
createdb erp_backend_test
TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/erp_backend_test?schema=public" npx prisma db push --skip-generate
TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/erp_backend_test?schema=public" npm test
```

`prisma db push` prepares the dedicated test database directly from `prisma/schema.prisma`; it does not create or apply a Prisma migration. The test bootstrap seeds only the minimum records needed for the requisition, customer order, sales invoice, approval-versioning, authentication, and user-response tests. Never point `TEST_DATABASE_URL` at a development or production database.
