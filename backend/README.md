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
- `TEST_DATABASE_URL`: dedicated PostgreSQL connection string used only by integration tests.
- `PORT`: optional HTTP port, default `4000`.
- `AUTH_TOKEN_SECRET`: HMAC secret for temporary development bearer tokens; required outside development.

The repository contains the `prisma/migrations/0_init` baseline migration, and Prisma recognizes it as the current migration baseline. Run `npm run prisma:generate` whenever the active schema changes.

## Development seed

With a development-only `DATABASE_URL` configured, run:

```bash
npm run seed
```

The seed is idempotent and only creates clearly marked development records. It does not apply migrations. Development users are `dev.admin`, `dev.procurement.manager`, `dev.stores.manager`, `dev.production.manager`, `dev.finance.manager`, and `dev.sales.manager`, matching the Admin, Procurement Manager, Stores Manager, Production Manager, Finance Manager, and Sales Manager roles. Password verification is not implemented; each user contains a non-production placeholder hash.

Seeded records include HMFL Manufacturing Pvt Ltd, Main Factory, two warehouses, six departments, permissions and role mappings, four item categories, four inventory items, two vendors, two customers, one machine, one expense category, one bank account, nine chart-of-account entries, opening raw-material and finished-goods stock, a BOM, production and work orders, four approval workflows, a purchase requisition, purchase order, GRN, customer order, sales invoice, document, and pending invoice extraction review.

## Authentication and authorization

The temporary development mechanism is an HMAC-signed bearer token: `Bearer <user-id>.<signature>`. Generate one with `createAuthToken` from `middleware/auth.js`. The middleware loads the active user, role, and `role_permission` records from the schema, leaving the route contract ready for JWT verification later.

Mutating master CRUD endpoints require `master.write`; inventory endpoints use `inventory.write`; procurement endpoints use `procurement.write`; sales endpoints use `sales.write`; document creation/update uses `documents.write`; document review GET/PATCH uses `documents.review`; approval requests use `approvals.create`; approval actions use `approvals.action`. Missing credentials return `401`, while insufficient permissions return `403`. User list, get, create, and update responses never expose `password_hash`.

## API

Successful responses use `{ "success": true, "data": ... }`. Errors use `{ "success": false, "error": { "message": "..." } }`. List endpoints accept `page`, `pageSize`, `search`, and, where applicable, `status`.

Master data CRUD is available under `/api/master` for `companies`, `factories`, `departments`, `employees`, `users`, `roles`, `permissions`, `customers`, `vendors`, `item-categories`, `inventory-items`, and `warehouses`. Customer and vendor aliases are also available at `/api/customers` and `/api/vendors`.

Inventory CRUD is available under `/api/inventory/items`, `/api/inventory/warehouses`, `/api/inventory/lots`, and `/api/inventory/movements`. GRN inventory posting is available through the protected `/api/procurement/grns/:id/post` endpoint and requires `inventory.write`.

Production inventory posting is available through these protected endpoints, which require `inventory.write`:

- `POST /api/production/work-orders/:id/consume` (consume BOM components from inventory)
- `POST /api/production/work-orders/:id/output` (receive finished goods into inventory)

Both operations run transactionally and create `stock_movement` records with `PRODUCTION_CONSUMPTION` or `PRODUCTION_OUTPUT` movement types.

Transactional creation endpoints:

- `POST /api/procurement/requisitions`
- `POST /api/procurement/purchase-orders`
- `POST /api/procurement/grns`
- `POST /api/procurement/grns/:id/post` (inspect a pending GRN and post accepted quantities to inventory)
- `POST /api/sales/orders`
- `POST /api/sales/deliveries`
- `POST /api/sales/deliveries/:id/dispatch` (protected by `inventory.write`; deducts available stock atomically)
- `POST /api/sales/invoices`
- `POST /api/documents`
- `POST /api/documents/upload`
- `GET /api/documents`
- `GET /api/documents/:id`
- `GET /api/documents/:id/file`
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

## OCR document ingestion

Open `http://localhost:4000` after starting the backend and use **Documents → Scan / Upload**. The backend accepts JPG, JPEG, PNG, and PDF files up to 10 MB. It saves the binary outside the source code in `backend/uploads/` (which is ignored by Git), stores only metadata in PostgreSQL, and serves originals through the authenticated `GET /api/documents/:id/file` route.

For JPG/PNG, Tesseract.js performs local OCR; no cloud OCR key is required. The result is stored as raw OCR text and passed to a deterministic Indian-invoice parser for invoice number, date, GSTIN, vendor, tax totals, and potential item lines. Validation then calculates a confidence score. Missing or inconsistent fields produce `NEEDS_REVIEW`; OCR data is never automatically approved. PDFs are securely uploaded and marked for manual review in this first version because Tesseract.js does not render PDF pages itself.

The Documents UI uses the existing bearer-token authorization. In development, generate a token for a seeded user with `createAuthToken` from `middleware/auth.js`, then paste the token into the Documents connection prompt. A production ERP login should supply that same existing token in `localStorage.erpAuthToken`; the OCR feature does not add a second authentication system.

Reviewers with `documents.review` can edit extracted values, save corrections, approve a valid document, or reject it. Approval is refused until validation issues are resolved. Upload/update needs `documents.write`. The current feature only prepares reviewed documents; it does not create vendor invoices, post stock, create accounting entries, or pay anything automatically.

## Deferred workflows

GRN posting creates inventory stock and `PURCHASE_RECEIPT` stock movements. Delivery dispatch creates `SALE_ISSUE` movements and deducts stock atomically; insufficient stock blocks the complete dispatch. Partial dispatch, inventory transfers, job-work movements, accounting posting, payment allocation, and automatic approval transitions remain deferred. Future payment settlement must use `payment_allocation`; no API in this foundation treats direct invoice references on `payment` as a settlement source.

## Tests

```bash
npm test
```

`npm test` always runs `test/api.test.js` through Node's test runner and does not depend on shell glob behavior. Integration tests use only `TEST_DATABASE_URL`; they seed the minimum company, customer, vendor, inventory item, role, permissions, user, and workflow records, then clean up created records after the run.

Prepare a dedicated test database from the active schema and run all tests with:

```bash
TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/erp_backend_test?schema=public" npx prisma db push --skip-generate
TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/erp_backend_test?schema=public" npm test
```

Never set `TEST_DATABASE_URL` to a development or production database. The setup does not create a migration.
