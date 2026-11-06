# Phases 1–3 production-readiness roadmap

## Goal and current evidence

Preserve the implemented procurement and sales transaction flows while making them safe and operable for real users. The repository is at `75fe359` on `main` and has the Phase 2/3 schema, routes and tests. The reported 277/277 test result and Neon migration status are historical; repeat them in an isolated environment before release.

The read-only audit found three concrete risks. `backend/controllers/crudController.js` does not scope generic list/get/update/delete by company, and the corresponding generic GET routes do not require authentication. `backend/README.md` describes a development HMAC bearer token and placeholder password hashes; `app/app.js` enters the UI without credential verification. Document binaries are stored under ignored `backend/uploads/`, so a fresh Codespace or deployment does not carry them. Sales GL mapping columns exist but are nullable for older companies. There is no `.github/workflows` directory in this checkout.

## Rules for every work package

Before changing a package, inspect `backend/prisma/schema.prisma`, affected controllers/routes/tests, the relevant migration history, and current deployment configuration. Record the audit finding and exact scope. Add focused tests, run related regression tests, and at each checkpoint run the complete backend suite and Prisma validation. Report exact pass/fail/skip counts and staging smoke results. Never reset a shared database; any required schema change needs a new reviewed migration and explicit approval before application. Do not silently alter working inventory posting or financial history.

## Work packages, in dependency order

### 0. Establish a reproducible baseline

Inventory every API and UI path actually used in Phases 1–3; record company ownership, read/write permission, source tables, test coverage, and frontend state. Capture clean-checkout build/test results, migration status against a dedicated staging database, and a protected snapshot/restore point. Define separate development, staging, and production configuration and a release gate. This is read-only except for planning/test-environment setup.

**Done when:** an endpoint/role/company matrix exists; current tests and schema status have exact recorded output; staging cannot accidentally point to production Neon.

### 1. Close cross-company access paths

First, protect generic master and inventory reads with authentication and appropriate permissions. Then add company scoping to generic list/get/create/update/delete, following each model's ownership chain (for example warehouse → factory → company). Validate related IDs on writes and prevent changing ownership via PATCH. Review workflow reads, document access, finance configuration, nested objects, search, counts, and pagination for equivalent leaks. Avoid deleting posted inventory or financial records through generic CRUD.

**Done when:** two-company integration tests show company A cannot enumerate, fetch, mutate, or infer company B's records through any audited path; same-company operations still work; unauthorized and unauthenticated requests return suitable 401/403/404 responses.

### 2. Replace development sign-in with real identity and permission enforcement

Agree on the production identity source (internal password login or company SSO) and implement one supported login/session flow. Migrate placeholder user setup, add password verification or SSO validation, expiration/revocation, secure browser token handling, logout, account disablement, and audit events. Remove the frontend's demo sign-in and manual token prompt from production mode. Define a role/action matrix and test positive and negative permissions for procurement, dispatch, sales, finance, approvals, documents, and admin. Keep existing RBAC semantics unless an approved role decision requires change.

**Done when:** a user cannot enter protected data without a valid session; disabling a user removes access; unauthorized roles cannot invoke financial writes; no password hashes or secrets appear in API responses or browser logs.

### 3. Make finance configuration an onboarding gate

Audit each company's chart of accounts, sales/purchase account mappings, bank mappings, and tax behavior. Add a read-only configuration-health endpoint or equivalent admin view, then a controlled admin setup flow using the existing `company_finance_config` and bank mapping APIs. Keep invoice/payment posting atomic when mappings are incomplete, but show a clear preflight error before the user attempts a transaction. Reconcile representative AP/AR balances to journals.

**Done when:** a new company can complete setup without hard-coded IDs; valid invoice and payment postings produce balanced journals; missing/inactive/wrong-company mappings are rejected before posting and do not leave partial records.

### 4. Make document and OCR data durable

Replace Codespace-local `backend/uploads/` as the sole binary store with private durable storage and authenticated retrieval. Keep metadata in PostgreSQL; use stable object keys, integrity checks, access controls, and backup/retention rules. Reconcile existing document rows against available originals; mark missing originals explicitly and recover only from actual backups/source files. Build a representative invoice/receipt OCR evaluation set, measure field-level extraction and review rates, and improve parsing incrementally while preserving human review.

**Done when:** an uploaded file remains retrievable after a fresh deployment; missing legacy files are reported rather than shown as successful OCR; OCR changes are measured against a fixed sample set and do not regress existing tests.

### 5. Add CI and safe staging deployment

Add automated install, syntax/build, Prisma validation, focused/full tests, and migration inspection to pull requests. Use an isolated disposable test DB; never run migrate reset against shared Neon. Deploy to a staging environment with separate secrets, storage, and database. Run migration deploy and API/browser smoke tests there; require those checks before production promotion. Document rollback of code and forward-only recovery of data.

**Done when:** a deliberately failing test or schema drift blocks promotion; a clean main commit deploys to staging and completes procurement, GRN, sales dispatch, invoice, payment, document upload, and journal smoke flows.

### 6. Add operations and recovery controls

Rotate any credentials exposed during troubleshooting, move all secrets to managed environment settings, and test expiration/rotation. Add structured request/error logs and alerts for repeated 5xx responses, DB connection failures, failed background/OCR jobs, and journal imbalance; avoid logging documents or secrets. Verify backup coverage for Neon *and* document binaries; perform a timed restore drill to a separate environment. Write an incident and deployment runbook with owners and escalation contacts.

**Done when:** an operator can identify a failing request, receive an alert, restore a usable test copy within the agreed recovery target, and follow a documented rollback/recovery procedure.

### 7. Finish and validate user workflows

For each role, map every screen to a working API path and remove misleading static success labels. Complete the user journeys for procurement/GRN, OCR review, AP/payment, sales/dispatch, AR/receipt, ledger/reporting, and admin setup. Run browser tests and a short UAT script with realistic company data and both allowed/denied roles. Record usability defects separately from backend defects.

**Done when:** users can complete each supported workflow without developer tokens or manual database edits, failures are actionable, and finance/inventory outcomes match backend records.

### 8. Publish the API contract and release decision

Document authenticated endpoints, permissions, validation/error shapes, idempotency and concurrency expectations, migration procedure, and versioning policy. Produce a release checklist with evidence links: test output, staging smoke, tenant isolation, role review, mapping readiness, restore drill, and UAT sign-off.

**Done when:** an integrator can use the API without reading controllers and the team can make a documented go/no-go decision.

## Checkpoints and priorities

- **Security gate:** packages 0–2. Do not onboard multiple companies or broad users before it passes.
- **Financial/data gate:** packages 3–4. Do not rely on posted sales or OCR originals until mapping and storage checks pass.
- **Operational gate:** packages 5–6. Do not call the service production-ready without staging, alerts, and a restore drill.
- **Release gate:** packages 7–8 plus full backend suite, schema checks, and end-to-end smoke tests.

## Key decisions to make during audits

1. Which identity provider and session policy HMFL will operate.
2. Whether master data such as item categories and roles is global or company-owned; enforce a consistent rule per model.
3. Which durable private file store and retention period to use.
4. Required recovery targets, staging ownership, and finance approvers.

These decisions do not authorize schema or production changes. If a package truly requires a schema change, prepare a separate migration proposal and review its SQL before applying it to a disposable test database.
