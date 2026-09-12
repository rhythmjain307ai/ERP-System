-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."accounting_entry" (
    "accounting_entry_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "entry_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "source_type" TEXT,
    "source_id" BIGINT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_entry_pkey" PRIMARY KEY ("accounting_entry_id")
);

-- CreateTable
CREATE TABLE "public"."accounts_payable" (
    "accounts_payable_id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "vendor_invoice_id" BIGINT,
    "expense_id" BIGINT,
    "due_date" DATE,
    "invoice_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "outstanding_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "accounts_payable_pkey" PRIMARY KEY ("accounts_payable_id")
);

-- CreateTable
CREATE TABLE "public"."accounts_receivable" (
    "accounts_receivable_id" BIGSERIAL NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "sales_invoice_id" BIGINT,
    "due_date" DATE,
    "invoice_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "received_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "outstanding_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "accounts_receivable_pkey" PRIMARY KEY ("accounts_receivable_id")
);

-- CreateTable
CREATE TABLE "public"."approval_action" (
    "approval_action_id" BIGSERIAL NOT NULL,
    "approval_request_id" BIGINT,
    "approval_workflow_id" BIGINT NOT NULL,
    "approval_step_id" BIGINT,
    "transaction_type" TEXT NOT NULL,
    "transaction_id" BIGINT NOT NULL,
    "action_by" BIGINT,
    "action" TEXT NOT NULL,
    "action_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comments" TEXT,

    CONSTRAINT "approval_action_pkey" PRIMARY KEY ("approval_action_id")
);

-- CreateTable
CREATE TABLE "public"."approval_request" (
    "approval_request_id" BIGSERIAL NOT NULL,
    "approval_workflow_id" BIGINT NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "transaction_id" BIGINT NOT NULL,
    "requester_id" BIGINT,
    "current_step_number" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),
    "remarks" TEXT,
    "request_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "approval_request_pkey" PRIMARY KEY ("approval_request_id")
);

-- CreateTable
CREATE TABLE "public"."approval_step" (
    "approval_step_id" BIGSERIAL NOT NULL,
    "approval_workflow_id" BIGINT NOT NULL,
    "step_number" INTEGER NOT NULL,
    "role_id" BIGINT,
    "step_name" TEXT NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "approval_step_pkey" PRIMARY KEY ("approval_step_id")
);

-- CreateTable
CREATE TABLE "public"."approval_workflow" (
    "approval_workflow_id" BIGSERIAL NOT NULL,
    "workflow_name" TEXT NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "approval_workflow_pkey" PRIMARY KEY ("approval_workflow_id")
);

-- CreateTable
CREATE TABLE "public"."attendance" (
    "attendance_id" BIGSERIAL NOT NULL,
    "employee_id" BIGINT NOT NULL,
    "attendance_date" DATE NOT NULL,
    "scheduled_hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "actual_hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "overtime_hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "deduction_hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PRESENT',
    "check_in" TIMESTAMPTZ(6),
    "check_out" TIMESTAMPTZ(6),
    "remarks" TEXT,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("attendance_id")
);

-- CreateTable
CREATE TABLE "public"."audit_log" (
    "audit_log_id" BIGSERIAL NOT NULL,
    "user_id" BIGINT,
    "action" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "record_id" BIGINT,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" INET,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("audit_log_id")
);

-- CreateTable
CREATE TABLE "public"."bank_account" (
    "bank_account_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_name" TEXT,
    "account_number" TEXT NOT NULL,
    "ifsc_code" TEXT,
    "branch_name" TEXT,
    "opening_balance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "current_balance" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "bank_account_pkey" PRIMARY KEY ("bank_account_id")
);

-- CreateTable
CREATE TABLE "public"."bank_transaction" (
    "bank_transaction_id" BIGSERIAL NOT NULL,
    "bank_account_id" BIGINT NOT NULL,
    "payment_id" BIGINT,
    "transaction_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "transaction_type" TEXT NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "reference_number" TEXT,
    "description" TEXT,
    "running_balance" DECIMAL(16,2),

    CONSTRAINT "bank_transaction_pkey" PRIMARY KEY ("bank_transaction_id")
);

-- CreateTable
CREATE TABLE "public"."bill_of_material" (
    "bom_id" BIGSERIAL NOT NULL,
    "finished_item_id" BIGINT NOT NULL,
    "bom_code" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE,
    "effective_to" DATE,

    CONSTRAINT "bill_of_material_pkey" PRIMARY KEY ("bom_id")
);

-- CreateTable
CREATE TABLE "public"."bom_item" (
    "bom_item_id" BIGSERIAL NOT NULL,
    "bom_id" BIGINT NOT NULL,
    "component_item_id" BIGINT NOT NULL,
    "quantity_per_unit" DECIMAL(18,6) NOT NULL,
    "uom" VARCHAR(20) NOT NULL,
    "scrap_percentage" DECIMAL(7,3) NOT NULL DEFAULT 0,

    CONSTRAINT "bom_item_pkey" PRIMARY KEY ("bom_item_id")
);

-- CreateTable
CREATE TABLE "public"."chart_of_account" (
    "account_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "parent_account_id" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "chart_of_account_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "public"."company" (
    "company_id" BIGSERIAL NOT NULL,
    "company_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "gstin" VARCHAR(15),
    "pan" VARCHAR(10),
    "cin" VARCHAR(21),
    "email" TEXT,
    "phone" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "state_code" VARCHAR(5),
    "pincode" VARCHAR(10),
    "country" TEXT NOT NULL DEFAULT 'India',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "public"."customer" (
    "customer_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "customer_code" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "gstin" VARCHAR(15),
    "pan" VARCHAR(10),
    "email" TEXT,
    "phone" TEXT,
    "billing_address" TEXT,
    "shipping_address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "state_code" VARCHAR(5),
    "pincode" VARCHAR(10),
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "credit_limit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "customer_pkey" PRIMARY KEY ("customer_id")
);

-- CreateTable
CREATE TABLE "public"."customer_ledger" (
    "customer_ledger_id" BIGSERIAL NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "transaction_date" DATE NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" BIGINT,
    "debit_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "customer_ledger_pkey" PRIMARY KEY ("customer_ledger_id")
);

-- CreateTable
CREATE TABLE "public"."customer_order" (
    "customer_order_id" BIGSERIAL NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "order_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "buyer_order_number" TEXT,
    "buyer_order_date" DATE,
    "order_type" TEXT NOT NULL DEFAULT 'SALES',
    "payment_terms" TEXT,
    "bill_to_address" TEXT,
    "ship_to_address" TEXT,
    "consignee_name" TEXT,
    "consignee_address" TEXT,
    "place_of_supply" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "remarks" TEXT,

    CONSTRAINT "customer_order_pkey" PRIMARY KEY ("customer_order_id")
);

-- CreateTable
CREATE TABLE "public"."customer_order_item" (
    "customer_order_item_id" BIGSERIAL NOT NULL,
    "customer_order_id" BIGINT NOT NULL,
    "inventory_item_id" BIGINT NOT NULL,
    "description" TEXT,
    "hsn_sac_code" VARCHAR(20),
    "uom" VARCHAR(20) NOT NULL,
    "ordered_quantity" DECIMAL(18,3) NOT NULL,
    "unit_rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "line_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,

    CONSTRAINT "customer_order_item_pkey" PRIMARY KEY ("customer_order_item_id")
);

-- CreateTable
CREATE TABLE "public"."delivery" (
    "delivery_id" BIGSERIAL NOT NULL,
    "delivery_number" TEXT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "customer_order_id" BIGINT,
    "sales_invoice_id" BIGINT,
    "warehouse_id" BIGINT,
    "delivery_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "challan_number" TEXT,
    "transporter" TEXT,
    "vehicle_number" TEXT,
    "lr_number" TEXT,
    "destination" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,

    CONSTRAINT "delivery_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateTable
CREATE TABLE "public"."delivery_item" (
    "delivery_item_id" BIGSERIAL NOT NULL,
    "delivery_id" BIGINT NOT NULL,
    "customer_order_item_id" BIGINT,
    "sales_invoice_item_id" BIGINT,
    "inventory_item_id" BIGINT NOT NULL,
    "lot_id" BIGINT,
    "description" TEXT,
    "uom" VARCHAR(20) NOT NULL,
    "ordered_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "delivered_quantity" DECIMAL(18,3) NOT NULL,
    "weight_kg" DECIMAL(18,3),
    "remarks" TEXT,

    CONSTRAINT "delivery_item_pkey" PRIMARY KEY ("delivery_item_id")
);

-- CreateTable
CREATE TABLE "public"."department" (
    "department_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "department_code" TEXT NOT NULL,
    "department_name" TEXT NOT NULL,

    CONSTRAINT "department_pkey" PRIMARY KEY ("department_id")
);

-- CreateTable
CREATE TABLE "public"."document" (
    "document_id" BIGSERIAL NOT NULL,
    "document_type" TEXT NOT NULL,
    "reference_type" TEXT,
    "reference_id" BIGINT,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT,
    "mime_type" TEXT,
    "uploaded_by" BIGINT,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "document_pkey" PRIMARY KEY ("document_id")
);

-- CreateTable
CREATE TABLE "public"."employee" (
    "employee_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "factory_id" BIGINT,
    "department_id" BIGINT,
    "employee_code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "middle_name" TEXT,
    "last_name" TEXT,
    "designation" TEXT,
    "joining_date" DATE,
    "leaving_date" DATE,
    "employment_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "pan" VARCHAR(10),
    "pf_number" TEXT,
    "pt_number" TEXT,
    "bank_name" TEXT,
    "bank_account_number" TEXT,
    "bank_ifsc" TEXT,
    "scheduled_daily_hours" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("employee_id")
);

-- CreateTable
CREATE TABLE "public"."employee_salary_history" (
    "salary_history_id" BIGSERIAL NOT NULL,
    "employee_id" BIGINT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "basic_salary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "hra" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "allowances" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overtime_rate" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pf_rate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "pt_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gross_salary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_salary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remarks" TEXT,

    CONSTRAINT "employee_salary_history_pkey" PRIMARY KEY ("salary_history_id")
);

-- CreateTable
CREATE TABLE "public"."expense" (
    "expense_id" BIGSERIAL NOT NULL,
    "expense_number" TEXT NOT NULL,
    "vendor_id" BIGINT,
    "expense_category_id" BIGINT NOT NULL,
    "expense_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "bill_number" TEXT,
    "bill_date" DATE,
    "payment_terms" TEXT,
    "taxable_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("expense_id")
);

-- CreateTable
CREATE TABLE "public"."expense_category" (
    "expense_category_id" BIGSERIAL NOT NULL,
    "category_name" TEXT NOT NULL,
    "parent_category_id" BIGINT,
    "category_group" TEXT NOT NULL DEFAULT 'OTHER_EXPENSE',
    "description" TEXT,

    CONSTRAINT "expense_category_pkey" PRIMARY KEY ("expense_category_id")
);

-- CreateTable
CREATE TABLE "public"."expense_item" (
    "expense_item_id" BIGSERIAL NOT NULL,
    "expense_id" BIGINT NOT NULL,
    "inventory_item_id" BIGINT,
    "description" TEXT NOT NULL,
    "uom" VARCHAR(20),
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 1,
    "trip_number" TEXT,
    "measurement" DECIMAL(18,3),
    "measurement_uom" VARCHAR(20),
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "line_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,

    CONSTRAINT "expense_item_pkey" PRIMARY KEY ("expense_item_id")
);

-- CreateTable
CREATE TABLE "public"."factory" (
    "factory_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "factory_code" TEXT NOT NULL,
    "factory_name" TEXT NOT NULL,
    "gstin" VARCHAR(15),
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "state_code" VARCHAR(5),
    "pincode" VARCHAR(10),
    "phone" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factory_pkey" PRIMARY KEY ("factory_id")
);

-- CreateTable
CREATE TABLE "public"."grn" (
    "grn_id" BIGSERIAL NOT NULL,
    "grn_number" TEXT NOT NULL,
    "purchase_order_id" BIGINT,
    "vendor_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT NOT NULL,
    "vendor_invoice_id" BIGINT,
    "grn_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "gate_entry_number" TEXT,
    "supplier_invoice_number" TEXT,
    "challan_number" TEXT,
    "transporter" TEXT,
    "vehicle_number" TEXT,
    "lr_number" TEXT,
    "inspection_status" TEXT NOT NULL DEFAULT 'PENDING',
    "inspected_by" BIGINT,
    "inspection_date" DATE,
    "remarks" TEXT,

    CONSTRAINT "grn_pkey" PRIMARY KEY ("grn_id")
);

-- CreateTable
CREATE TABLE "public"."grn_item" (
    "grn_item_id" BIGSERIAL NOT NULL,
    "grn_id" BIGINT NOT NULL,
    "purchase_order_item_id" BIGINT,
    "inventory_item_id" BIGINT NOT NULL,
    "lot_id" BIGINT,
    "heat_number" TEXT,
    "uom" VARCHAR(20) NOT NULL,
    "challan_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "received_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "accepted_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rejected_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rejection_reason" TEXT,
    "rate" DECIMAL(18,4) NOT NULL DEFAULT 0,

    CONSTRAINT "grn_item_pkey" PRIMARY KEY ("grn_item_id")
);

-- CreateTable
CREATE TABLE "public"."inventory_item" (
    "inventory_item_id" BIGSERIAL NOT NULL,
    "item_category_id" BIGINT,
    "item_code" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "description" TEXT,
    "item_type" TEXT NOT NULL DEFAULT 'OTHER',
    "hsn_sac_code" VARCHAR(20),
    "base_uom" VARCHAR(20) NOT NULL,
    "gst_rate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "is_stock_item" BOOLEAN NOT NULL DEFAULT true,
    "is_lot_tracked" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "inventory_item_pkey" PRIMARY KEY ("inventory_item_id")
);

-- CreateTable
CREATE TABLE "public"."inventory_lot" (
    "lot_id" BIGSERIAL NOT NULL,
    "inventory_item_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT NOT NULL,
    "lot_number" TEXT NOT NULL,
    "heat_number" TEXT,
    "supplier_id" BIGINT,
    "received_date" DATE,
    "quantity_received" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "accepted_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rejected_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "remarks" TEXT,

    CONSTRAINT "inventory_lot_pkey" PRIMARY KEY ("lot_id")
);

-- CreateTable
CREATE TABLE "public"."inventory_stock" (
    "inventory_stock_id" BIGSERIAL NOT NULL,
    "inventory_item_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT NOT NULL,
    "lot_id" BIGINT,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "reserved_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "last_updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_stock_pkey" PRIMARY KEY ("inventory_stock_id")
);

-- CreateTable
CREATE TABLE "public"."invoice_extraction_review" (
    "invoice_extraction_review_id" BIGSERIAL NOT NULL,
    "document_id" BIGINT NOT NULL,
    "extraction_status" TEXT NOT NULL DEFAULT 'PENDING',
    "extraction_engine" TEXT,
    "extraction_version" TEXT,
    "raw_ocr_output" JSONB,
    "extracted_fields" JSONB,
    "confidence_score" DECIMAL(6,5),
    "validation_errors" JSONB,
    "reviewer_id" BIGINT,
    "reviewer_decision" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_extraction_review_pkey" PRIMARY KEY ("invoice_extraction_review_id")
);

-- CreateTable
CREATE TABLE "public"."item_category" (
    "item_category_id" BIGSERIAL NOT NULL,
    "category_name" TEXT NOT NULL,
    "parent_category_id" BIGINT,
    "description" TEXT,

    CONSTRAINT "item_category_pkey" PRIMARY KEY ("item_category_id")
);

-- CreateTable
CREATE TABLE "public"."job_work_challan" (
    "job_work_challan_id" BIGSERIAL NOT NULL,
    "challan_number" TEXT NOT NULL,
    "job_work_order_id" BIGINT NOT NULL,
    "job_worker_vendor_id" BIGINT NOT NULL,
    "challan_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "party_challan_number" TEXT,
    "vehicle_number" TEXT,
    "transporter" TEXT,
    "lr_number" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'JOBWORK',
    "eway_bill_number" TEXT,
    "eway_bill_date" TIMESTAMPTZ(6),
    "eway_bill_valid_until" TIMESTAMPTZ(6),
    "irn" TEXT,
    "ack_number" TEXT,
    "ack_date" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,

    CONSTRAINT "job_work_challan_pkey" PRIMARY KEY ("job_work_challan_id")
);

-- CreateTable
CREATE TABLE "public"."job_work_challan_item" (
    "job_work_challan_item_id" BIGSERIAL NOT NULL,
    "job_work_challan_id" BIGINT NOT NULL,
    "inventory_item_id" BIGINT NOT NULL,
    "lot_id" BIGINT,
    "description" TEXT,
    "hsn_sac_code" VARCHAR(20),
    "uom" VARCHAR(20) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "weight_kg" DECIMAL(18,3),
    "rate" DECIMAL(18,4),
    "remarks" TEXT,

    CONSTRAINT "job_work_challan_item_pkey" PRIMARY KEY ("job_work_challan_item_id")
);

-- CreateTable
CREATE TABLE "public"."job_work_order" (
    "job_work_order_id" BIGSERIAL NOT NULL,
    "job_work_order_number" TEXT NOT NULL,
    "job_worker_vendor_id" BIGINT NOT NULL,
    "customer_order_id" BIGINT,
    "factory_id" BIGINT NOT NULL,
    "order_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "process_name" TEXT NOT NULL,
    "party_po_number" TEXT,
    "planned_quantity" DECIMAL(18,3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "remarks" TEXT,

    CONSTRAINT "job_work_order_pkey" PRIMARY KEY ("job_work_order_id")
);

-- CreateTable
CREATE TABLE "public"."job_work_receipt" (
    "job_work_receipt_id" BIGSERIAL NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "job_work_order_id" BIGINT NOT NULL,
    "job_work_challan_id" BIGINT,
    "receipt_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "vehicle_number" TEXT,
    "transporter" TEXT,
    "gate_entry_number" TEXT,
    "inspection_status" TEXT NOT NULL DEFAULT 'PENDING',
    "inspected_by" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "remarks" TEXT,

    CONSTRAINT "job_work_receipt_pkey" PRIMARY KEY ("job_work_receipt_id")
);

-- CreateTable
CREATE TABLE "public"."job_work_receipt_item" (
    "job_work_receipt_item_id" BIGSERIAL NOT NULL,
    "job_work_receipt_id" BIGINT NOT NULL,
    "inventory_item_id" BIGINT NOT NULL,
    "lot_id" BIGINT,
    "description" TEXT,
    "uom" VARCHAR(20) NOT NULL,
    "challan_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "received_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "accepted_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rejected_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "rejection_reason" TEXT,
    "heat_number" TEXT,

    CONSTRAINT "job_work_receipt_item_pkey" PRIMARY KEY ("job_work_receipt_item_id")
);

-- CreateTable
CREATE TABLE "public"."journal_entry" (
    "journal_entry_id" BIGSERIAL NOT NULL,
    "accounting_entry_id" BIGINT,
    "journal_number" TEXT NOT NULL,
    "entry_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "created_by" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entry_pkey" PRIMARY KEY ("journal_entry_id")
);

-- CreateTable
CREATE TABLE "public"."journal_line" (
    "journal_line_id" BIGSERIAL NOT NULL,
    "journal_entry_id" BIGINT NOT NULL,
    "account_id" BIGINT NOT NULL,
    "debit_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "journal_line_pkey" PRIMARY KEY ("journal_line_id")
);

-- CreateTable
CREATE TABLE "public"."leave" (
    "leave_id" BIGSERIAL NOT NULL,
    "employee_id" BIGINT NOT NULL,
    "leave_type" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" DECIMAL(6,2) NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approved_by" BIGINT,

    CONSTRAINT "leave_pkey" PRIMARY KEY ("leave_id")
);

-- CreateTable
CREATE TABLE "public"."machine" (
    "machine_id" BIGSERIAL NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "machine_code" TEXT NOT NULL,
    "machine_name" TEXT NOT NULL,
    "machine_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "machine_pkey" PRIMARY KEY ("machine_id")
);

-- CreateTable
CREATE TABLE "public"."payment" (
    "payment_id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT,
    "customer_id" BIGINT,
    "bank_account_id" BIGINT,
    "payment_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "payment_type" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'BANK',
    "reference_number" TEXT,
    "amount" DECIMAL(16,2) NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "public"."payment_allocation" (
    "payment_allocation_id" BIGSERIAL NOT NULL,
    "payment_id" BIGINT NOT NULL,
    "accounts_payable_id" BIGINT,
    "accounts_receivable_id" BIGINT,
    "allocated_amount" DECIMAL(16,2) NOT NULL,
    "allocated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,

    CONSTRAINT "payment_allocation_pkey" PRIMARY KEY ("payment_allocation_id")
);

-- CreateTable
CREATE TABLE "public"."payroll" (
    "payroll_id" BIGSERIAL NOT NULL,
    "employee_id" BIGINT NOT NULL,
    "payroll_month" DATE NOT NULL,
    "salary_history_id" BIGINT,
    "basic_salary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "overtime_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "allowances" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gross_salary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pf_deduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "pt_deduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net_salary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "paid_at" TIMESTAMPTZ(6),

    CONSTRAINT "payroll_pkey" PRIMARY KEY ("payroll_id")
);

-- CreateTable
CREATE TABLE "public"."permission" (
    "permission_id" BIGSERIAL NOT NULL,
    "permission_code" TEXT NOT NULL,
    "permission_name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("permission_id")
);

-- CreateTable
CREATE TABLE "public"."production_consumption" (
    "production_consumption_id" BIGSERIAL NOT NULL,
    "production_order_id" BIGINT NOT NULL,
    "work_order_id" BIGINT,
    "inventory_item_id" BIGINT NOT NULL,
    "lot_id" BIGINT,
    "warehouse_id" BIGINT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,

    CONSTRAINT "production_consumption_pkey" PRIMARY KEY ("production_consumption_id")
);

-- CreateTable
CREATE TABLE "public"."production_order" (
    "production_order_id" BIGSERIAL NOT NULL,
    "production_order_number" TEXT NOT NULL,
    "inventory_item_id" BIGINT NOT NULL,
    "bom_id" BIGINT,
    "factory_id" BIGINT NOT NULL,
    "planned_quantity" DECIMAL(18,3) NOT NULL,
    "planned_start_date" DATE,
    "planned_end_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "remarks" TEXT,

    CONSTRAINT "production_order_pkey" PRIMARY KEY ("production_order_id")
);

-- CreateTable
CREATE TABLE "public"."production_output" (
    "production_output_id" BIGSERIAL NOT NULL,
    "production_order_id" BIGINT NOT NULL,
    "work_order_id" BIGINT,
    "inventory_item_id" BIGINT NOT NULL,
    "lot_id" BIGINT,
    "warehouse_id" BIGINT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "rejected_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "produced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,

    CONSTRAINT "production_output_pkey" PRIMARY KEY ("production_output_id")
);

-- CreateTable
CREATE TABLE "public"."purchase_order" (
    "purchase_order_id" BIGSERIAL NOT NULL,
    "po_number" TEXT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "purchase_requisition_id" BIGINT,
    "order_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "expected_date" DATE,
    "payment_terms" TEXT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "taxable_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("purchase_order_id")
);

-- CreateTable
CREATE TABLE "public"."purchase_order_item" (
    "purchase_order_item_id" BIGSERIAL NOT NULL,
    "purchase_order_id" BIGINT NOT NULL,
    "inventory_item_id" BIGINT NOT NULL,
    "description" TEXT,
    "hsn_sac_code" VARCHAR(20),
    "uom" VARCHAR(20) NOT NULL,
    "ordered_quantity" DECIMAL(18,3) NOT NULL,
    "unit_rate" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "line_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_item_pkey" PRIMARY KEY ("purchase_order_item_id")
);

-- CreateTable
CREATE TABLE "public"."purchase_requisition" (
    "purchase_requisition_id" BIGSERIAL NOT NULL,
    "requisition_number" TEXT NOT NULL,
    "department_id" BIGINT,
    "requested_by" BIGINT,
    "requisition_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "required_date" DATE,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "remarks" TEXT,

    CONSTRAINT "purchase_requisition_pkey" PRIMARY KEY ("purchase_requisition_id")
);

-- CreateTable
CREATE TABLE "public"."purchase_requisition_item" (
    "purchase_requisition_item_id" BIGSERIAL NOT NULL,
    "purchase_requisition_id" BIGINT NOT NULL,
    "inventory_item_id" BIGINT NOT NULL,
    "description" TEXT,
    "uom" VARCHAR(20) NOT NULL,
    "requested_quantity" DECIMAL(18,3) NOT NULL,
    "required_date" DATE,
    "remarks" TEXT,

    CONSTRAINT "purchase_requisition_item_pkey" PRIMARY KEY ("purchase_requisition_item_id")
);

-- CreateTable
CREATE TABLE "public"."role" (
    "role_id" BIGSERIAL NOT NULL,
    "role_name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "role_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "public"."role_permission" (
    "role_id" BIGINT NOT NULL,
    "permission_id" BIGINT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "public"."sales_invoice" (
    "sales_invoice_id" BIGSERIAL NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_type" TEXT NOT NULL DEFAULT 'TAX_INVOICE',
    "customer_id" BIGINT NOT NULL,
    "customer_order_id" BIGINT,
    "invoice_date" DATE NOT NULL DEFAULT CURRENT_DATE,
    "buyer_order_number" TEXT,
    "buyer_order_date" DATE,
    "payment_terms" TEXT,
    "due_date" DATE,
    "supplier_reference" TEXT,
    "bill_to_name" TEXT,
    "bill_to_address" TEXT,
    "bill_to_gstin" VARCHAR(15),
    "ship_to_name" TEXT,
    "ship_to_address" TEXT,
    "ship_to_gstin" VARCHAR(15),
    "consignee_name" TEXT,
    "consignee_address" TEXT,
    "consignee_gstin" VARCHAR(15),
    "place_of_supply" TEXT,
    "transporter" TEXT,
    "vehicle_number" TEXT,
    "lr_number" TEXT,
    "eway_bill_number" TEXT,
    "eway_bill_date" TIMESTAMPTZ(6),
    "eway_bill_valid_until" TIMESTAMPTZ(6),
    "irn" TEXT,
    "ack_number" TEXT,
    "ack_date" TIMESTAMPTZ(6),
    "taxable_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cess_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "other_charges" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,

    CONSTRAINT "sales_invoice_pkey" PRIMARY KEY ("sales_invoice_id")
);

-- CreateTable
CREATE TABLE "public"."sales_invoice_item" (
    "sales_invoice_item_id" BIGSERIAL NOT NULL,
    "sales_invoice_id" BIGINT NOT NULL,
    "customer_order_item_id" BIGINT,
    "inventory_item_id" BIGINT,
    "description" TEXT NOT NULL,
    "hsn_sac_code" VARCHAR(20),
    "uom" VARCHAR(20) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cess_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(16,2) NOT NULL DEFAULT 0,

    CONSTRAINT "sales_invoice_item_pkey" PRIMARY KEY ("sales_invoice_item_id")
);

-- CreateTable
CREATE TABLE "public"."stock_movement" (
    "stock_movement_id" BIGSERIAL NOT NULL,
    "inventory_item_id" BIGINT NOT NULL,
    "warehouse_id" BIGINT NOT NULL,
    "lot_id" BIGINT,
    "movement_type" TEXT NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL,
    "reference_type" TEXT,
    "reference_id" BIGINT,
    "movement_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remarks" TEXT,

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("stock_movement_id")
);

-- CreateTable
CREATE TABLE "public"."users" (
    "user_id" BIGSERIAL NOT NULL,
    "employee_id" BIGINT,
    "role_id" BIGINT,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "public"."vendor" (
    "vendor_id" BIGSERIAL NOT NULL,
    "company_id" BIGINT NOT NULL,
    "vendor_code" TEXT NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "gstin" VARCHAR(15),
    "pan" VARCHAR(10),
    "email" TEXT,
    "phone" TEXT,
    "billing_address" TEXT,
    "shipping_address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "state_code" VARCHAR(5),
    "pincode" VARCHAR(10),
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "is_job_worker" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "vendor_pkey" PRIMARY KEY ("vendor_id")
);

-- CreateTable
CREATE TABLE "public"."vendor_invoice" (
    "vendor_invoice_id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "purchase_order_id" BIGINT,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "payment_terms" TEXT,
    "place_of_supply" TEXT,
    "supplier_gstin" VARCHAR(15),
    "recipient_gstin" VARCHAR(15),
    "supplier_reference" TEXT,
    "taxable_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "cess_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "other_charges" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "round_off" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'BOOKED',

    CONSTRAINT "vendor_invoice_pkey" PRIMARY KEY ("vendor_invoice_id")
);

-- CreateTable
CREATE TABLE "public"."vendor_invoice_grn_match" (
    "vendor_invoice_grn_match_id" BIGSERIAL NOT NULL,
    "vendor_invoice_item_id" BIGINT NOT NULL,
    "grn_item_id" BIGINT NOT NULL,
    "matched_quantity" DECIMAL(18,3) NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "vendor_invoice_grn_match_pkey" PRIMARY KEY ("vendor_invoice_grn_match_id")
);

-- CreateTable
CREATE TABLE "public"."vendor_invoice_item" (
    "vendor_invoice_item_id" BIGSERIAL NOT NULL,
    "vendor_invoice_id" BIGINT NOT NULL,
    "purchase_order_item_id" BIGINT,
    "inventory_item_id" BIGINT,
    "description" TEXT NOT NULL,
    "hsn_sac_code" VARCHAR(20),
    "uom" VARCHAR(20) NOT NULL,
    "quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "gst_rate" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "cgst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "sgst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "igst_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(16,2) NOT NULL DEFAULT 0,

    CONSTRAINT "vendor_invoice_item_pkey" PRIMARY KEY ("vendor_invoice_item_id")
);

-- CreateTable
CREATE TABLE "public"."vendor_ledger" (
    "vendor_ledger_id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "transaction_date" DATE NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" BIGINT,
    "debit_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "vendor_ledger_pkey" PRIMARY KEY ("vendor_ledger_id")
);

-- CreateTable
CREATE TABLE "public"."warehouse" (
    "warehouse_id" BIGSERIAL NOT NULL,
    "factory_id" BIGINT NOT NULL,
    "warehouse_code" TEXT NOT NULL,
    "warehouse_name" TEXT NOT NULL,
    "location" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "warehouse_pkey" PRIMARY KEY ("warehouse_id")
);

-- CreateTable
CREATE TABLE "public"."weighbridge_ticket" (
    "weighbridge_ticket_id" BIGSERIAL NOT NULL,
    "ticket_number" TEXT NOT NULL,
    "ticket_date" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehicle_number" TEXT NOT NULL,
    "transporter" TEXT,
    "gross_weight_kg" DECIMAL(18,3) NOT NULL,
    "tare_weight_kg" DECIMAL(18,3) NOT NULL,
    "net_weight_kg" DECIMAL(18,3) DEFAULT (gross_weight_kg - tare_weight_kg),
    "grn_id" BIGINT,
    "delivery_id" BIGINT,
    "job_work_challan_id" BIGINT,
    "operator_name" TEXT,
    "remarks" TEXT,

    CONSTRAINT "weighbridge_ticket_pkey" PRIMARY KEY ("weighbridge_ticket_id")
);

-- CreateTable
CREATE TABLE "public"."work_order" (
    "work_order_id" BIGSERIAL NOT NULL,
    "production_order_id" BIGINT,
    "machine_id" BIGINT,
    "work_order_number" TEXT NOT NULL,
    "operation_name" TEXT NOT NULL,
    "planned_quantity" DECIMAL(18,3),
    "actual_quantity" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "start_time" TIMESTAMPTZ(6),
    "end_time" TIMESTAMPTZ(6),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,

    CONSTRAINT "work_order_pkey" PRIMARY KEY ("work_order_id")
);

-- CreateIndex
CREATE INDEX "idx_accounting_entry_company_date" ON "public"."accounting_entry"("company_id" ASC, "entry_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_payable_vendor_invoice_id_key" ON "public"."accounts_payable"("vendor_invoice_id" ASC);

-- CreateIndex
CREATE INDEX "idx_payable_vendor_status" ON "public"."accounts_payable"("vendor_id" ASC, "status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_receivable_sales_invoice_id_key" ON "public"."accounts_receivable"("sales_invoice_id" ASC);

-- CreateIndex
CREATE INDEX "idx_receivable_customer_status" ON "public"."accounts_receivable"("customer_id" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_approval_action_transaction" ON "public"."approval_action"("transaction_type" ASC, "transaction_id" ASC);

-- CreateIndex
CREATE INDEX "idx_approval_request_status" ON "public"."approval_request"("status" ASC);

-- CreateIndex
CREATE INDEX "idx_approval_request_transaction" ON "public"."approval_request"("transaction_type" ASC, "transaction_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_approval_request_transaction_version" ON "public"."approval_request"("transaction_type" ASC, "transaction_id" ASC, "request_version" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "approval_step_approval_workflow_id_step_number_key" ON "public"."approval_step"("approval_workflow_id" ASC, "step_number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "approval_workflow_workflow_name_key" ON "public"."approval_workflow"("workflow_name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_employee_id_attendance_date_key" ON "public"."attendance"("employee_id" ASC, "attendance_date" ASC);

-- CreateIndex
CREATE INDEX "idx_attendance_date" ON "public"."attendance"("attendance_date" ASC);

-- CreateIndex
CREATE INDEX "idx_audit_log_table_record" ON "public"."audit_log"("table_name" ASC, "record_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "bank_account_company_id_account_number_key" ON "public"."bank_account"("company_id" ASC, "account_number" ASC);

-- CreateIndex
CREATE INDEX "idx_bank_transaction_date" ON "public"."bank_transaction"("transaction_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "bill_of_material_bom_code_key" ON "public"."bill_of_material"("bom_code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "bill_of_material_finished_item_id_version_key" ON "public"."bill_of_material"("finished_item_id" ASC, "version" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "bom_item_bom_id_component_item_id_key" ON "public"."bom_item"("bom_id" ASC, "component_item_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "chart_of_account_company_id_account_code_key" ON "public"."chart_of_account"("company_id" ASC, "account_code" ASC);

-- CreateIndex
CREATE INDEX "idx_chart_of_account_company" ON "public"."chart_of_account"("company_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "company_gstin_key" ON "public"."company"("gstin" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "customer_company_id_customer_code_key" ON "public"."customer"("company_id" ASC, "customer_code" ASC);

-- CreateIndex
CREATE INDEX "idx_customer_gstin" ON "public"."customer"("gstin" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "customer_order_order_number_key" ON "public"."customer_order"("order_number" ASC);

-- CreateIndex
CREATE INDEX "idx_customer_order_customer_date" ON "public"."customer_order"("customer_id" ASC, "order_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_delivery_number_key" ON "public"."delivery"("delivery_number" ASC);

-- CreateIndex
CREATE INDEX "idx_delivery_customer_date" ON "public"."delivery"("customer_id" ASC, "delivery_date" ASC);

-- CreateIndex
CREATE INDEX "idx_delivery_item_delivery" ON "public"."delivery_item"("delivery_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "department_company_id_department_code_key" ON "public"."department"("company_id" ASC, "department_code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "department_company_id_department_name_key" ON "public"."department"("company_id" ASC, "department_name" ASC);

-- CreateIndex
CREATE INDEX "idx_document_reference" ON "public"."document"("reference_type" ASC, "reference_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "employee_company_id_employee_code_key" ON "public"."employee"("company_id" ASC, "employee_code" ASC);

-- CreateIndex
CREATE INDEX "idx_employee_department" ON "public"."employee"("department_id" ASC);

-- CreateIndex
CREATE INDEX "idx_employee_factory" ON "public"."employee"("factory_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "expense_expense_number_key" ON "public"."expense"("expense_number" ASC);

-- CreateIndex
CREATE INDEX "idx_expense_category_date" ON "public"."expense"("expense_category_id" ASC, "expense_date" ASC);

-- CreateIndex
CREATE INDEX "idx_expense_date" ON "public"."expense"("expense_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "expense_category_category_name_key" ON "public"."expense_category"("category_name" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "factory_company_id_factory_code_key" ON "public"."factory"("company_id" ASC, "factory_code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "grn_grn_number_key" ON "public"."grn"("grn_number" ASC);

-- CreateIndex
CREATE INDEX "idx_grn_vendor_date" ON "public"."grn"("vendor_id" ASC, "grn_date" ASC);

-- CreateIndex
CREATE INDEX "idx_grn_item_heat" ON "public"."grn_item"("heat_number" ASC);

-- CreateIndex
CREATE INDEX "idx_inventory_item_category" ON "public"."inventory_item"("item_category_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_item_item_code_key" ON "public"."inventory_item"("item_code" ASC);

-- CreateIndex
CREATE INDEX "idx_inventory_lot_heat" ON "public"."inventory_lot"("heat_number" ASC);

-- CreateIndex
CREATE INDEX "idx_inventory_lot_item" ON "public"."inventory_lot"("inventory_item_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_lot_warehouse_id_lot_number_key" ON "public"."inventory_lot"("warehouse_id" ASC, "lot_number" ASC);

-- CreateIndex
CREATE INDEX "idx_inventory_stock_item_warehouse" ON "public"."inventory_stock"("inventory_item_id" ASC, "warehouse_id" ASC);

-- CreateIndex
CREATE INDEX "idx_invoice_extraction_status" ON "public"."invoice_extraction_review"("extraction_status" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_extraction_review_document_id_key" ON "public"."invoice_extraction_review"("document_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "item_category_category_name_key" ON "public"."item_category"("category_name" ASC);

-- CreateIndex
CREATE INDEX "idx_job_work_challan_date" ON "public"."job_work_challan"("challan_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "job_work_challan_challan_number_key" ON "public"."job_work_challan"("challan_number" ASC);

-- CreateIndex
CREATE INDEX "idx_job_work_order_worker" ON "public"."job_work_order"("job_worker_vendor_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "job_work_order_job_work_order_number_key" ON "public"."job_work_order"("job_work_order_number" ASC);

-- CreateIndex
CREATE INDEX "idx_job_work_receipt_date" ON "public"."job_work_receipt"("receipt_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "job_work_receipt_receipt_number_key" ON "public"."job_work_receipt"("receipt_number" ASC);

-- CreateIndex
CREATE INDEX "idx_journal_entry_date" ON "public"."journal_entry"("entry_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_journal_number_key" ON "public"."journal_entry"("journal_number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "machine_factory_id_machine_code_key" ON "public"."machine"("factory_id" ASC, "machine_code" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_date" ON "public"."payment"("payment_date" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_allocation_payable" ON "public"."payment_allocation"("accounts_payable_id" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_allocation_payment" ON "public"."payment_allocation"("payment_id" ASC);

-- CreateIndex
CREATE INDEX "idx_payment_allocation_receivable" ON "public"."payment_allocation"("accounts_receivable_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_employee_id_payroll_month_key" ON "public"."payroll"("employee_id" ASC, "payroll_month" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "permission_permission_code_key" ON "public"."permission"("permission_code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "production_order_production_order_number_key" ON "public"."production_order"("production_order_number" ASC);

-- CreateIndex
CREATE INDEX "idx_purchase_order_vendor_date" ON "public"."purchase_order"("vendor_id" ASC, "order_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_po_number_key" ON "public"."purchase_order"("po_number" ASC);

-- CreateIndex
CREATE INDEX "idx_purchase_requisition_date" ON "public"."purchase_requisition"("requisition_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisition_requisition_number_key" ON "public"."purchase_requisition"("requisition_number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "role_role_name_key" ON "public"."role"("role_name" ASC);

-- CreateIndex
CREATE INDEX "idx_sales_invoice_customer_date" ON "public"."sales_invoice"("customer_id" ASC, "invoice_date" ASC);

-- CreateIndex
CREATE INDEX "idx_sales_invoice_eway" ON "public"."sales_invoice"("eway_bill_number" ASC);

-- CreateIndex
CREATE INDEX "idx_sales_invoice_irn" ON "public"."sales_invoice"("irn" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_invoice_number_key" ON "public"."sales_invoice"("invoice_number" ASC);

-- CreateIndex
CREATE INDEX "idx_stock_movement_item_date" ON "public"."stock_movement"("inventory_item_id" ASC, "movement_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "public"."users"("employee_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "public"."users"("username" ASC);

-- CreateIndex
CREATE INDEX "idx_vendor_gstin" ON "public"."vendor"("gstin" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_company_id_vendor_code_key" ON "public"."vendor"("company_id" ASC, "vendor_code" ASC);

-- CreateIndex
CREATE INDEX "idx_vendor_invoice_date" ON "public"."vendor_invoice"("invoice_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_invoice_vendor_id_invoice_number_key" ON "public"."vendor_invoice"("vendor_id" ASC, "invoice_number" ASC);

-- CreateIndex
CREATE INDEX "idx_vendor_invoice_grn_match_grn" ON "public"."vendor_invoice_grn_match"("grn_item_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_vendor_invoice_grn_match" ON "public"."vendor_invoice_grn_match"("vendor_invoice_item_id" ASC, "grn_item_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "warehouse_factory_id_warehouse_code_key" ON "public"."warehouse"("factory_id" ASC, "warehouse_code" ASC);

-- CreateIndex
CREATE INDEX "idx_weighbridge_vehicle_date" ON "public"."weighbridge_ticket"("vehicle_number" ASC, "ticket_date" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "weighbridge_ticket_ticket_number_key" ON "public"."weighbridge_ticket"("ticket_number" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "work_order_work_order_number_key" ON "public"."work_order"("work_order_number" ASC);

-- AddForeignKey
ALTER TABLE "public"."accounting_entry" ADD CONSTRAINT "accounting_entry_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."accounting_entry" ADD CONSTRAINT "accounting_entry_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."accounts_payable" ADD CONSTRAINT "accounts_payable_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("expense_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."accounts_payable" ADD CONSTRAINT "accounts_payable_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("vendor_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."accounts_payable" ADD CONSTRAINT "accounts_payable_vendor_invoice_id_fkey" FOREIGN KEY ("vendor_invoice_id") REFERENCES "public"."vendor_invoice"("vendor_invoice_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."accounts_receivable" ADD CONSTRAINT "accounts_receivable_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("customer_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."accounts_receivable" ADD CONSTRAINT "accounts_receivable_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("sales_invoice_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_action" ADD CONSTRAINT "approval_action_action_by_fkey" FOREIGN KEY ("action_by") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_action" ADD CONSTRAINT "approval_action_approval_request_id_fkey" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_request"("approval_request_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_action" ADD CONSTRAINT "approval_action_approval_step_id_fkey" FOREIGN KEY ("approval_step_id") REFERENCES "public"."approval_step"("approval_step_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_action" ADD CONSTRAINT "approval_action_approval_workflow_id_fkey" FOREIGN KEY ("approval_workflow_id") REFERENCES "public"."approval_workflow"("approval_workflow_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_request" ADD CONSTRAINT "approval_request_approval_workflow_id_fkey" FOREIGN KEY ("approval_workflow_id") REFERENCES "public"."approval_workflow"("approval_workflow_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_request" ADD CONSTRAINT "approval_request_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_step" ADD CONSTRAINT "approval_step_approval_workflow_id_fkey" FOREIGN KEY ("approval_workflow_id") REFERENCES "public"."approval_workflow"("approval_workflow_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."approval_step" ADD CONSTRAINT "approval_step_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."role"("role_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."attendance" ADD CONSTRAINT "attendance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("employee_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."bank_account" ADD CONSTRAINT "bank_account_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."bank_transaction" ADD CONSTRAINT "bank_transaction_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_account"("bank_account_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."bank_transaction" ADD CONSTRAINT "bank_transaction_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("payment_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."bill_of_material" ADD CONSTRAINT "bill_of_material_finished_item_id_fkey" FOREIGN KEY ("finished_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."bom_item" ADD CONSTRAINT "bom_item_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "public"."bill_of_material"("bom_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."bom_item" ADD CONSTRAINT "bom_item_component_item_id_fkey" FOREIGN KEY ("component_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."chart_of_account" ADD CONSTRAINT "chart_of_account_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."chart_of_account" ADD CONSTRAINT "chart_of_account_parent_account_id_fkey" FOREIGN KEY ("parent_account_id") REFERENCES "public"."chart_of_account"("account_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."customer" ADD CONSTRAINT "customer_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."customer_ledger" ADD CONSTRAINT "customer_ledger_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("customer_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."customer_order" ADD CONSTRAINT "customer_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("customer_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."customer_order_item" ADD CONSTRAINT "customer_order_item_customer_order_id_fkey" FOREIGN KEY ("customer_order_id") REFERENCES "public"."customer_order"("customer_order_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."customer_order_item" ADD CONSTRAINT "customer_order_item_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."delivery" ADD CONSTRAINT "delivery_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("customer_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."delivery" ADD CONSTRAINT "delivery_customer_order_id_fkey" FOREIGN KEY ("customer_order_id") REFERENCES "public"."customer_order"("customer_order_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."delivery" ADD CONSTRAINT "delivery_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("sales_invoice_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."delivery" ADD CONSTRAINT "delivery_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("warehouse_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."delivery_item" ADD CONSTRAINT "delivery_item_customer_order_item_id_fkey" FOREIGN KEY ("customer_order_item_id") REFERENCES "public"."customer_order_item"("customer_order_item_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."delivery_item" ADD CONSTRAINT "delivery_item_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("delivery_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."delivery_item" ADD CONSTRAINT "delivery_item_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."delivery_item" ADD CONSTRAINT "delivery_item_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lot"("lot_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."delivery_item" ADD CONSTRAINT "delivery_item_sales_invoice_item_id_fkey" FOREIGN KEY ("sales_invoice_item_id") REFERENCES "public"."sales_invoice_item"("sales_invoice_item_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."department" ADD CONSTRAINT "department_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."document" ADD CONSTRAINT "document_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."employee" ADD CONSTRAINT "employee_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."employee" ADD CONSTRAINT "employee_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."department"("department_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."employee" ADD CONSTRAINT "employee_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "public"."factory"("factory_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."employee_salary_history" ADD CONSTRAINT "employee_salary_history_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("employee_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."expense" ADD CONSTRAINT "expense_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "public"."expense_category"("expense_category_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."expense" ADD CONSTRAINT "expense_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("vendor_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."expense_category" ADD CONSTRAINT "expense_category_parent_category_id_fkey" FOREIGN KEY ("parent_category_id") REFERENCES "public"."expense_category"("expense_category_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."expense_item" ADD CONSTRAINT "expense_item_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "public"."expense"("expense_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."expense_item" ADD CONSTRAINT "expense_item_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."factory" ADD CONSTRAINT "factory_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."grn" ADD CONSTRAINT "grn_inspected_by_fkey" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."grn" ADD CONSTRAINT "grn_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("purchase_order_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."grn" ADD CONSTRAINT "grn_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("vendor_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."grn" ADD CONSTRAINT "grn_vendor_invoice_id_fkey" FOREIGN KEY ("vendor_invoice_id") REFERENCES "public"."vendor_invoice"("vendor_invoice_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."grn" ADD CONSTRAINT "grn_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("warehouse_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."grn_item" ADD CONSTRAINT "grn_item_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "public"."grn"("grn_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."grn_item" ADD CONSTRAINT "grn_item_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."grn_item" ADD CONSTRAINT "grn_item_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lot"("lot_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."grn_item" ADD CONSTRAINT "grn_item_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_item"("purchase_order_item_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_item" ADD CONSTRAINT "inventory_item_item_category_id_fkey" FOREIGN KEY ("item_category_id") REFERENCES "public"."item_category"("item_category_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_lot" ADD CONSTRAINT "inventory_lot_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_lot" ADD CONSTRAINT "inventory_lot_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."vendor"("vendor_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_lot" ADD CONSTRAINT "inventory_lot_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("warehouse_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_stock" ADD CONSTRAINT "inventory_stock_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_stock" ADD CONSTRAINT "inventory_stock_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lot"("lot_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."inventory_stock" ADD CONSTRAINT "inventory_stock_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("warehouse_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."invoice_extraction_review" ADD CONSTRAINT "invoice_extraction_review_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."document"("document_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."invoice_extraction_review" ADD CONSTRAINT "invoice_extraction_review_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."item_category" ADD CONSTRAINT "item_category_parent_category_id_fkey" FOREIGN KEY ("parent_category_id") REFERENCES "public"."item_category"("item_category_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_challan" ADD CONSTRAINT "job_work_challan_job_work_order_id_fkey" FOREIGN KEY ("job_work_order_id") REFERENCES "public"."job_work_order"("job_work_order_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_challan" ADD CONSTRAINT "job_work_challan_job_worker_vendor_id_fkey" FOREIGN KEY ("job_worker_vendor_id") REFERENCES "public"."vendor"("vendor_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_challan_item" ADD CONSTRAINT "job_work_challan_item_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_challan_item" ADD CONSTRAINT "job_work_challan_item_job_work_challan_id_fkey" FOREIGN KEY ("job_work_challan_id") REFERENCES "public"."job_work_challan"("job_work_challan_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_challan_item" ADD CONSTRAINT "job_work_challan_item_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lot"("lot_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_order" ADD CONSTRAINT "job_work_order_customer_order_id_fkey" FOREIGN KEY ("customer_order_id") REFERENCES "public"."customer_order"("customer_order_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_order" ADD CONSTRAINT "job_work_order_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "public"."factory"("factory_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_order" ADD CONSTRAINT "job_work_order_job_worker_vendor_id_fkey" FOREIGN KEY ("job_worker_vendor_id") REFERENCES "public"."vendor"("vendor_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_receipt" ADD CONSTRAINT "job_work_receipt_inspected_by_fkey" FOREIGN KEY ("inspected_by") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_receipt" ADD CONSTRAINT "job_work_receipt_job_work_challan_id_fkey" FOREIGN KEY ("job_work_challan_id") REFERENCES "public"."job_work_challan"("job_work_challan_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_receipt" ADD CONSTRAINT "job_work_receipt_job_work_order_id_fkey" FOREIGN KEY ("job_work_order_id") REFERENCES "public"."job_work_order"("job_work_order_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_receipt_item" ADD CONSTRAINT "job_work_receipt_item_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_receipt_item" ADD CONSTRAINT "job_work_receipt_item_job_work_receipt_id_fkey" FOREIGN KEY ("job_work_receipt_id") REFERENCES "public"."job_work_receipt"("job_work_receipt_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."job_work_receipt_item" ADD CONSTRAINT "job_work_receipt_item_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lot"("lot_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."journal_entry" ADD CONSTRAINT "journal_entry_accounting_entry_id_fkey" FOREIGN KEY ("accounting_entry_id") REFERENCES "public"."accounting_entry"("accounting_entry_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."journal_entry" ADD CONSTRAINT "journal_entry_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."journal_line" ADD CONSTRAINT "journal_line_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."journal_line" ADD CONSTRAINT "journal_line_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entry"("journal_entry_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."leave" ADD CONSTRAINT "leave_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."leave" ADD CONSTRAINT "leave_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("employee_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."machine" ADD CONSTRAINT "machine_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "public"."factory"("factory_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment" ADD CONSTRAINT "payment_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_account"("bank_account_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment" ADD CONSTRAINT "payment_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("customer_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment" ADD CONSTRAINT "payment_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("vendor_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_allocation" ADD CONSTRAINT "payment_allocation_accounts_payable_id_fkey" FOREIGN KEY ("accounts_payable_id") REFERENCES "public"."accounts_payable"("accounts_payable_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_allocation" ADD CONSTRAINT "payment_allocation_accounts_receivable_id_fkey" FOREIGN KEY ("accounts_receivable_id") REFERENCES "public"."accounts_receivable"("accounts_receivable_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payment_allocation" ADD CONSTRAINT "payment_allocation_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("payment_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payroll" ADD CONSTRAINT "payroll_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("employee_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."payroll" ADD CONSTRAINT "payroll_salary_history_id_fkey" FOREIGN KEY ("salary_history_id") REFERENCES "public"."employee_salary_history"("salary_history_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_consumption" ADD CONSTRAINT "production_consumption_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_consumption" ADD CONSTRAINT "production_consumption_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lot"("lot_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_consumption" ADD CONSTRAINT "production_consumption_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_order"("production_order_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_consumption" ADD CONSTRAINT "production_consumption_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("warehouse_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_consumption" ADD CONSTRAINT "production_consumption_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("work_order_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_order" ADD CONSTRAINT "production_order_bom_id_fkey" FOREIGN KEY ("bom_id") REFERENCES "public"."bill_of_material"("bom_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_order" ADD CONSTRAINT "production_order_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "public"."factory"("factory_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_order" ADD CONSTRAINT "production_order_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_output" ADD CONSTRAINT "production_output_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_output" ADD CONSTRAINT "production_output_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lot"("lot_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_output" ADD CONSTRAINT "production_output_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_order"("production_order_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_output" ADD CONSTRAINT "production_output_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("warehouse_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."production_output" ADD CONSTRAINT "production_output_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_order"("work_order_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_order" ADD CONSTRAINT "purchase_order_purchase_requisition_id_fkey" FOREIGN KEY ("purchase_requisition_id") REFERENCES "public"."purchase_requisition"("purchase_requisition_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_order" ADD CONSTRAINT "purchase_order_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("vendor_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_item" ADD CONSTRAINT "purchase_order_item_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_order_item" ADD CONSTRAINT "purchase_order_item_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("purchase_order_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_requisition" ADD CONSTRAINT "purchase_requisition_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "public"."department"("department_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_requisition" ADD CONSTRAINT "purchase_requisition_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_requisition_item" ADD CONSTRAINT "purchase_requisition_item_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."purchase_requisition_item" ADD CONSTRAINT "purchase_requisition_item_purchase_requisition_id_fkey" FOREIGN KEY ("purchase_requisition_id") REFERENCES "public"."purchase_requisition"("purchase_requisition_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."role_permission" ADD CONSTRAINT "role_permission_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "public"."permission"("permission_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."role"("role_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sales_invoice" ADD CONSTRAINT "sales_invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("customer_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sales_invoice" ADD CONSTRAINT "sales_invoice_customer_order_id_fkey" FOREIGN KEY ("customer_order_id") REFERENCES "public"."customer_order"("customer_order_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sales_invoice_item" ADD CONSTRAINT "sales_invoice_item_customer_order_item_id_fkey" FOREIGN KEY ("customer_order_item_id") REFERENCES "public"."customer_order_item"("customer_order_item_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sales_invoice_item" ADD CONSTRAINT "sales_invoice_item_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."sales_invoice_item" ADD CONSTRAINT "sales_invoice_item_sales_invoice_id_fkey" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoice"("sales_invoice_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."stock_movement" ADD CONSTRAINT "stock_movement_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."stock_movement" ADD CONSTRAINT "stock_movement_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lot"("lot_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."stock_movement" ADD CONSTRAINT "stock_movement_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("warehouse_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employee"("employee_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."users" ADD CONSTRAINT "users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."role"("role_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."vendor" ADD CONSTRAINT "vendor_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."company"("company_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."vendor_invoice" ADD CONSTRAINT "vendor_invoice_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_order"("purchase_order_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."vendor_invoice" ADD CONSTRAINT "vendor_invoice_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("vendor_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."vendor_invoice_grn_match" ADD CONSTRAINT "fk_vendor_invoice_grn_match_grn_item" FOREIGN KEY ("grn_item_id") REFERENCES "public"."grn_item"("grn_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."vendor_invoice_grn_match" ADD CONSTRAINT "fk_vendor_invoice_grn_match_invoice_item" FOREIGN KEY ("vendor_invoice_item_id") REFERENCES "public"."vendor_invoice_item"("vendor_invoice_item_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."vendor_invoice_item" ADD CONSTRAINT "vendor_invoice_item_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_item"("inventory_item_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."vendor_invoice_item" ADD CONSTRAINT "vendor_invoice_item_purchase_order_item_id_fkey" FOREIGN KEY ("purchase_order_item_id") REFERENCES "public"."purchase_order_item"("purchase_order_item_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."vendor_invoice_item" ADD CONSTRAINT "vendor_invoice_item_vendor_invoice_id_fkey" FOREIGN KEY ("vendor_invoice_id") REFERENCES "public"."vendor_invoice"("vendor_invoice_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."vendor_ledger" ADD CONSTRAINT "vendor_ledger_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendor"("vendor_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."warehouse" ADD CONSTRAINT "warehouse_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "public"."factory"("factory_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."weighbridge_ticket" ADD CONSTRAINT "weighbridge_ticket_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "public"."delivery"("delivery_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."weighbridge_ticket" ADD CONSTRAINT "weighbridge_ticket_grn_id_fkey" FOREIGN KEY ("grn_id") REFERENCES "public"."grn"("grn_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."weighbridge_ticket" ADD CONSTRAINT "weighbridge_ticket_job_work_challan_id_fkey" FOREIGN KEY ("job_work_challan_id") REFERENCES "public"."job_work_challan"("job_work_challan_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."work_order" ADD CONSTRAINT "work_order_machine_id_fkey" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("machine_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "public"."work_order" ADD CONSTRAINT "work_order_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_order"("production_order_id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- HMFL existing PostgreSQL CHECK constraints
-- Preserved from the existing Neon database for the baseline migration.

ALTER TABLE "public"."accounting_entry" ADD CONSTRAINT "accounting_entry_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'POSTED'::text, 'REVERSED'::text])));
ALTER TABLE "public"."accounts_payable" ADD CONSTRAINT "accounts_payable_outstanding_amount_check" CHECK ((outstanding_amount >= (0)::numeric));
ALTER TABLE "public"."accounts_payable" ADD CONSTRAINT "accounts_payable_paid_amount_check" CHECK ((paid_amount >= (0)::numeric));
ALTER TABLE "public"."accounts_payable" ADD CONSTRAINT "accounts_payable_status_check" CHECK ((status = ANY (ARRAY['OPEN'::text, 'PARTIALLY_PAID'::text, 'PAID'::text, 'OVERDUE'::text, 'CANCELLED'::text])));
ALTER TABLE "public"."accounts_receivable" ADD CONSTRAINT "accounts_receivable_outstanding_amount_check" CHECK ((outstanding_amount >= (0)::numeric));
ALTER TABLE "public"."accounts_receivable" ADD CONSTRAINT "accounts_receivable_received_amount_check" CHECK ((received_amount >= (0)::numeric));
ALTER TABLE "public"."accounts_receivable" ADD CONSTRAINT "accounts_receivable_status_check" CHECK ((status = ANY (ARRAY['OPEN'::text, 'PARTIALLY_RECEIVED'::text, 'RECEIVED'::text, 'OVERDUE'::text, 'CANCELLED'::text])));
ALTER TABLE "public"."approval_action" ADD CONSTRAINT "approval_action_action_check" CHECK ((action = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text, 'RETURNED'::text, 'SKIPPED'::text])));
ALTER TABLE "public"."approval_request" ADD CONSTRAINT "approval_request_current_step_number_check" CHECK ((current_step_number > 0));
ALTER TABLE "public"."approval_request" ADD CONSTRAINT "approval_request_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'RETURNED'::text, 'CANCELLED'::text])));
ALTER TABLE "public"."approval_step" ADD CONSTRAINT "approval_step_step_number_check" CHECK ((step_number > 0));
ALTER TABLE "public"."attendance" ADD CONSTRAINT "attendance_actual_hours_check" CHECK ((actual_hours >= (0)::numeric));
ALTER TABLE "public"."attendance" ADD CONSTRAINT "attendance_deduction_hours_check" CHECK ((deduction_hours >= (0)::numeric));
ALTER TABLE "public"."attendance" ADD CONSTRAINT "attendance_overtime_hours_check" CHECK ((overtime_hours >= (0)::numeric));
ALTER TABLE "public"."attendance" ADD CONSTRAINT "attendance_scheduled_hours_check" CHECK ((scheduled_hours >= (0)::numeric));
ALTER TABLE "public"."attendance" ADD CONSTRAINT "attendance_status_check" CHECK ((status = ANY (ARRAY['PRESENT'::text, 'ABSENT'::text, 'HALF_DAY'::text, 'LEAVE'::text, 'HOLIDAY'::text, 'WEEK_OFF'::text])));
ALTER TABLE "public"."bank_transaction" ADD CONSTRAINT "bank_transaction_amount_check" CHECK ((amount > (0)::numeric));
ALTER TABLE "public"."bank_transaction" ADD CONSTRAINT "bank_transaction_transaction_type_check" CHECK ((transaction_type = ANY (ARRAY['CREDIT'::text, 'DEBIT'::text])));
ALTER TABLE "public"."bom_item" ADD CONSTRAINT "bom_item_quantity_per_unit_check" CHECK ((quantity_per_unit > (0)::numeric));
ALTER TABLE "public"."bom_item" ADD CONSTRAINT "bom_item_scrap_percentage_check" CHECK ((scrap_percentage >= (0)::numeric));
ALTER TABLE "public"."chart_of_account" ADD CONSTRAINT "chart_of_account_account_type_check" CHECK ((account_type = ANY (ARRAY['ASSET'::text, 'LIABILITY'::text, 'EQUITY'::text, 'INCOME'::text, 'EXPENSE'::text])));
ALTER TABLE "public"."customer" ADD CONSTRAINT "customer_credit_limit_check" CHECK ((credit_limit >= (0)::numeric));
ALTER TABLE "public"."customer" ADD CONSTRAINT "customer_payment_terms_days_check" CHECK ((payment_terms_days >= 0));
ALTER TABLE "public"."customer_ledger" ADD CONSTRAINT "customer_ledger_credit_amount_check" CHECK ((credit_amount >= (0)::numeric));
ALTER TABLE "public"."customer_ledger" ADD CONSTRAINT "customer_ledger_debit_amount_check" CHECK ((debit_amount >= (0)::numeric));
ALTER TABLE "public"."customer_order" ADD CONSTRAINT "customer_order_order_type_check" CHECK ((order_type = ANY (ARRAY['SALES'::text, 'JOB_WORK'::text, 'SERVICE'::text])));
ALTER TABLE "public"."customer_order" ADD CONSTRAINT "customer_order_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'OPEN'::text, 'PARTIALLY_FULFILLED'::text, 'FULFILLED'::text, 'CANCELLED'::text, 'CLOSED'::text])));
ALTER TABLE "public"."customer_order_item" ADD CONSTRAINT "customer_order_item_ordered_quantity_check" CHECK ((ordered_quantity > (0)::numeric));
ALTER TABLE "public"."customer_order_item" ADD CONSTRAINT "customer_order_item_unit_rate_check" CHECK ((unit_rate >= (0)::numeric));
ALTER TABLE "public"."delivery" ADD CONSTRAINT "delivery_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'READY'::text, 'DISPATCHED'::text, 'DELIVERED'::text, 'CANCELLED'::text])));
ALTER TABLE "public"."delivery_item" ADD CONSTRAINT "delivery_item_delivered_quantity_check" CHECK ((delivered_quantity > (0)::numeric));
ALTER TABLE "public"."delivery_item" ADD CONSTRAINT "delivery_item_ordered_quantity_check" CHECK ((ordered_quantity >= (0)::numeric));
ALTER TABLE "public"."employee" ADD CONSTRAINT "employee_employment_status_check" CHECK ((employment_status = ANY (ARRAY['ACTIVE'::text, 'INACTIVE'::text, 'ON_NOTICE'::text, 'LEFT'::text])));
ALTER TABLE "public"."employee" ADD CONSTRAINT "employee_scheduled_daily_hours_check" CHECK ((scheduled_daily_hours >= (0)::numeric));
ALTER TABLE "public"."employee_salary_history" ADD CONSTRAINT "employee_salary_history_allowances_check" CHECK ((allowances >= (0)::numeric));
ALTER TABLE "public"."employee_salary_history" ADD CONSTRAINT "employee_salary_history_basic_salary_check" CHECK ((basic_salary >= (0)::numeric));
ALTER TABLE "public"."employee_salary_history" ADD CONSTRAINT "employee_salary_history_check" CHECK (((effective_to IS NULL) OR (effective_to >= effective_from)));
ALTER TABLE "public"."employee_salary_history" ADD CONSTRAINT "employee_salary_history_deductions_check" CHECK ((deductions >= (0)::numeric));
ALTER TABLE "public"."employee_salary_history" ADD CONSTRAINT "employee_salary_history_gross_salary_check" CHECK ((gross_salary >= (0)::numeric));
ALTER TABLE "public"."employee_salary_history" ADD CONSTRAINT "employee_salary_history_hra_check" CHECK ((hra >= (0)::numeric));
ALTER TABLE "public"."employee_salary_history" ADD CONSTRAINT "employee_salary_history_overtime_rate_check" CHECK ((overtime_rate >= (0)::numeric));
ALTER TABLE "public"."employee_salary_history" ADD CONSTRAINT "employee_salary_history_pf_rate_check" CHECK ((pf_rate >= (0)::numeric));
ALTER TABLE "public"."employee_salary_history" ADD CONSTRAINT "employee_salary_history_pt_amount_check" CHECK ((pt_amount >= (0)::numeric));
ALTER TABLE "public"."expense" ADD CONSTRAINT "expense_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'APPROVED'::text, 'BOOKED'::text, 'PAID'::text, 'REJECTED'::text])));
ALTER TABLE "public"."expense_category" ADD CONSTRAINT "expense_category_category_group_check" CHECK ((category_group = ANY (ARRAY['RAW_MATERIAL'::text, 'OTHER_EXPENSE'::text, 'PROFESSIONAL_CHARGES'::text, 'TECHNICAL_CHARGES'::text, 'LEGAL_CHARGES'::text, 'SERVICE_JOURNAL'::text, 'CONSUMABLE_STORES'::text, 'OIL'::text, 'MANUFACTURING_CHARGES'::text])));
ALTER TABLE "public"."expense_item" ADD CONSTRAINT "expense_item_quantity_check" CHECK ((quantity >= (0)::numeric));
ALTER TABLE "public"."expense_item" ADD CONSTRAINT "expense_item_rate_check" CHECK ((rate >= (0)::numeric));
ALTER TABLE "public"."grn" ADD CONSTRAINT "grn_inspection_status_check" CHECK ((inspection_status = ANY (ARRAY['PENDING'::text, 'PASSED'::text, 'PARTIAL'::text, 'FAILED'::text])));
ALTER TABLE "public"."grn_item" ADD CONSTRAINT "grn_item_accepted_quantity_check" CHECK ((accepted_quantity >= (0)::numeric));
ALTER TABLE "public"."grn_item" ADD CONSTRAINT "grn_item_challan_quantity_check" CHECK ((challan_quantity >= (0)::numeric));
ALTER TABLE "public"."grn_item" ADD CONSTRAINT "grn_item_check" CHECK (((accepted_quantity + rejected_quantity) <= received_quantity));
ALTER TABLE "public"."grn_item" ADD CONSTRAINT "grn_item_rate_check" CHECK ((rate >= (0)::numeric));
ALTER TABLE "public"."grn_item" ADD CONSTRAINT "grn_item_received_quantity_check" CHECK ((received_quantity >= (0)::numeric));
ALTER TABLE "public"."grn_item" ADD CONSTRAINT "grn_item_rejected_quantity_check" CHECK ((rejected_quantity >= (0)::numeric));
ALTER TABLE "public"."inventory_item" ADD CONSTRAINT "inventory_item_gst_rate_check" CHECK ((gst_rate >= (0)::numeric));
ALTER TABLE "public"."inventory_item" ADD CONSTRAINT "inventory_item_item_type_check" CHECK ((item_type = ANY (ARRAY['RAW_MATERIAL'::text, 'FINISHED_GOOD'::text, 'SEMI_FINISHED'::text, 'CONSUMABLE'::text, 'TOOL'::text, 'SERVICE'::text, 'SCRAP'::text, 'OTHER'::text])));
ALTER TABLE "public"."inventory_lot" ADD CONSTRAINT "inventory_lot_accepted_quantity_check" CHECK ((accepted_quantity >= (0)::numeric));
ALTER TABLE "public"."inventory_lot" ADD CONSTRAINT "inventory_lot_quantity_received_check" CHECK ((quantity_received >= (0)::numeric));
ALTER TABLE "public"."inventory_lot" ADD CONSTRAINT "inventory_lot_rejected_quantity_check" CHECK ((rejected_quantity >= (0)::numeric));
ALTER TABLE "public"."inventory_lot" ADD CONSTRAINT "inventory_lot_status_check" CHECK ((status = ANY (ARRAY['OPEN'::text, 'HOLD'::text, 'CLOSED'::text, 'REJECTED'::text])));
ALTER TABLE "public"."inventory_stock" ADD CONSTRAINT "inventory_stock_check" CHECK (((reserved_quantity >= (0)::numeric) AND (reserved_quantity <= quantity)));
ALTER TABLE "public"."inventory_stock" ADD CONSTRAINT "inventory_stock_quantity_check" CHECK ((quantity >= (0)::numeric));
ALTER TABLE "public"."invoice_extraction_review" ADD CONSTRAINT "invoice_extraction_review_confidence_score_check" CHECK (((confidence_score IS NULL) OR ((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric))));
ALTER TABLE "public"."invoice_extraction_review" ADD CONSTRAINT "invoice_extraction_review_extraction_status_check" CHECK ((extraction_status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'EXTRACTED'::text, 'VALIDATION_FAILED'::text, 'UNDER_REVIEW'::text, 'APPROVED'::text, 'REJECTED'::text])));
ALTER TABLE "public"."invoice_extraction_review" ADD CONSTRAINT "invoice_extraction_review_reviewer_decision_check" CHECK (((reviewer_decision IS NULL) OR (reviewer_decision = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text, 'NEEDS_CORRECTION'::text]))));
ALTER TABLE "public"."job_work_challan" ADD CONSTRAINT "job_work_challan_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'DISPATCHED'::text, 'IN_TRANSIT'::text, 'RECEIVED'::text, 'CANCELLED'::text])));
ALTER TABLE "public"."job_work_challan_item" ADD CONSTRAINT "job_work_challan_item_quantity_check" CHECK ((quantity > (0)::numeric));
ALTER TABLE "public"."job_work_order" ADD CONSTRAINT "job_work_order_status_check" CHECK ((status = ANY (ARRAY['OPEN'::text, 'MATERIAL_SENT'::text, 'IN_PROCESS'::text, 'PARTIALLY_RETURNED'::text, 'COMPLETED'::text, 'CANCELLED'::text])));
ALTER TABLE "public"."job_work_receipt" ADD CONSTRAINT "job_work_receipt_inspection_status_check" CHECK ((inspection_status = ANY (ARRAY['PENDING'::text, 'PASSED'::text, 'PARTIAL'::text, 'FAILED'::text])));
ALTER TABLE "public"."job_work_receipt" ADD CONSTRAINT "job_work_receipt_status_check" CHECK ((status = ANY (ARRAY['RECEIVED'::text, 'INSPECTED'::text, 'ACCEPTED'::text, 'PARTIAL'::text, 'REJECTED'::text, 'CLOSED'::text])));
ALTER TABLE "public"."job_work_receipt_item" ADD CONSTRAINT "job_work_receipt_item_accepted_quantity_check" CHECK ((accepted_quantity >= (0)::numeric));
ALTER TABLE "public"."job_work_receipt_item" ADD CONSTRAINT "job_work_receipt_item_challan_quantity_check" CHECK ((challan_quantity >= (0)::numeric));
ALTER TABLE "public"."job_work_receipt_item" ADD CONSTRAINT "job_work_receipt_item_check" CHECK (((accepted_quantity + rejected_quantity) <= received_quantity));
ALTER TABLE "public"."job_work_receipt_item" ADD CONSTRAINT "job_work_receipt_item_received_quantity_check" CHECK ((received_quantity >= (0)::numeric));
ALTER TABLE "public"."job_work_receipt_item" ADD CONSTRAINT "job_work_receipt_item_rejected_quantity_check" CHECK ((rejected_quantity >= (0)::numeric));
ALTER TABLE "public"."journal_entry" ADD CONSTRAINT "journal_entry_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'POSTED'::text, 'REVERSED'::text])));
ALTER TABLE "public"."journal_line" ADD CONSTRAINT "journal_line_check" CHECK ((((debit_amount > (0)::numeric) AND (credit_amount = (0)::numeric)) OR ((credit_amount > (0)::numeric) AND (debit_amount = (0)::numeric))));
ALTER TABLE "public"."journal_line" ADD CONSTRAINT "journal_line_credit_amount_check" CHECK ((credit_amount >= (0)::numeric));
ALTER TABLE "public"."journal_line" ADD CONSTRAINT "journal_line_debit_amount_check" CHECK ((debit_amount >= (0)::numeric));
ALTER TABLE "public"."leave" ADD CONSTRAINT "leave_check" CHECK ((end_date >= start_date));
ALTER TABLE "public"."leave" ADD CONSTRAINT "leave_days_check" CHECK ((days > (0)::numeric));
ALTER TABLE "public"."leave" ADD CONSTRAINT "leave_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])));
ALTER TABLE "public"."machine" ADD CONSTRAINT "machine_status_check" CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'IDLE'::text, 'MAINTENANCE'::text, 'BREAKDOWN'::text, 'RETIRED'::text])));
ALTER TABLE "public"."payment" ADD CONSTRAINT "payment_amount_check" CHECK ((amount > (0)::numeric));
ALTER TABLE "public"."payment" ADD CONSTRAINT "payment_check" CHECK (((vendor_id IS NOT NULL) OR (customer_id IS NOT NULL)));
ALTER TABLE "public"."payment" ADD CONSTRAINT "payment_mode_check" CHECK ((mode = ANY (ARRAY['BANK'::text, 'CASH'::text, 'CHEQUE'::text, 'UPI'::text, 'NEFT'::text, 'RTGS'::text, 'IMPS'::text, 'OTHER'::text])));
ALTER TABLE "public"."payment" ADD CONSTRAINT "payment_payment_type_check" CHECK ((payment_type = ANY (ARRAY['VENDOR_PAYMENT'::text, 'CUSTOMER_RECEIPT'::text, 'EXPENSE_PAYMENT'::text, 'OTHER'::text])));
ALTER TABLE "public"."payment_allocation" ADD CONSTRAINT "payment_allocation_allocated_amount_check" CHECK ((allocated_amount > (0)::numeric));
ALTER TABLE "public"."payment_allocation" ADD CONSTRAINT "payment_allocation_check" CHECK ((((accounts_payable_id IS NOT NULL) AND (accounts_receivable_id IS NULL)) OR ((accounts_payable_id IS NULL) AND (accounts_receivable_id IS NOT NULL))));
ALTER TABLE "public"."payroll" ADD CONSTRAINT "payroll_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'APPROVED'::text, 'PAID'::text])));
ALTER TABLE "public"."production_consumption" ADD CONSTRAINT "production_consumption_quantity_check" CHECK ((quantity > (0)::numeric));
ALTER TABLE "public"."production_order" ADD CONSTRAINT "production_order_planned_quantity_check" CHECK ((planned_quantity > (0)::numeric));
ALTER TABLE "public"."production_order" ADD CONSTRAINT "production_order_status_check" CHECK ((status = ANY (ARRAY['PLANNED'::text, 'RELEASED'::text, 'IN_PROGRESS'::text, 'COMPLETED'::text, 'CANCELLED'::text])));
ALTER TABLE "public"."production_output" ADD CONSTRAINT "production_output_quantity_check" CHECK ((quantity > (0)::numeric));
ALTER TABLE "public"."production_output" ADD CONSTRAINT "production_output_rejected_quantity_check" CHECK ((rejected_quantity >= (0)::numeric));
ALTER TABLE "public"."purchase_order" ADD CONSTRAINT "purchase_order_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'SENT'::text, 'PARTIALLY_RECEIVED'::text, 'RECEIVED'::text, 'CANCELLED'::text, 'CLOSED'::text])));
ALTER TABLE "public"."purchase_order_item" ADD CONSTRAINT "purchase_order_item_discount_amount_check" CHECK ((discount_amount >= (0)::numeric));
ALTER TABLE "public"."purchase_order_item" ADD CONSTRAINT "purchase_order_item_gst_rate_check" CHECK ((gst_rate >= (0)::numeric));
ALTER TABLE "public"."purchase_order_item" ADD CONSTRAINT "purchase_order_item_ordered_quantity_check" CHECK ((ordered_quantity > (0)::numeric));
ALTER TABLE "public"."purchase_order_item" ADD CONSTRAINT "purchase_order_item_unit_rate_check" CHECK ((unit_rate >= (0)::numeric));
ALTER TABLE "public"."purchase_requisition" ADD CONSTRAINT "purchase_requisition_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED'::text, 'APPROVED'::text, 'REJECTED'::text, 'CLOSED'::text])));
ALTER TABLE "public"."purchase_requisition_item" ADD CONSTRAINT "purchase_requisition_item_requested_quantity_check" CHECK ((requested_quantity > (0)::numeric));
ALTER TABLE "public"."sales_invoice" ADD CONSTRAINT "sales_invoice_invoice_type_check" CHECK ((invoice_type = ANY (ARRAY['TAX_INVOICE'::text, 'SERVICE_INVOICE'::text, 'JOB_WORK_INVOICE'::text, 'CREDIT_NOTE'::text, 'DEBIT_NOTE'::text])));
ALTER TABLE "public"."sales_invoice" ADD CONSTRAINT "sales_invoice_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ISSUED'::text, 'PARTIALLY_PAID'::text, 'PAID'::text, 'CANCELLED'::text])));
ALTER TABLE "public"."sales_invoice_item" ADD CONSTRAINT "sales_invoice_item_quantity_check" CHECK ((quantity >= (0)::numeric));
ALTER TABLE "public"."sales_invoice_item" ADD CONSTRAINT "sales_invoice_item_unit_price_check" CHECK ((unit_price >= (0)::numeric));
ALTER TABLE "public"."stock_movement" ADD CONSTRAINT "stock_movement_movement_type_check" CHECK ((movement_type = ANY (ARRAY['PURCHASE_RECEIPT'::text, 'SALE_ISSUE'::text, 'PRODUCTION_CONSUMPTION'::text, 'PRODUCTION_OUTPUT'::text, 'JOB_WORK_OUT'::text, 'JOB_WORK_IN'::text, 'TRANSFER_IN'::text, 'TRANSFER_OUT'::text, 'ADJUSTMENT_IN'::text, 'ADJUSTMENT_OUT'::text, 'RETURN_IN'::text, 'RETURN_OUT'::text])));
ALTER TABLE "public"."stock_movement" ADD CONSTRAINT "stock_movement_quantity_check" CHECK ((quantity > (0)::numeric));
ALTER TABLE "public"."vendor" ADD CONSTRAINT "vendor_payment_terms_days_check" CHECK ((payment_terms_days >= 0));
ALTER TABLE "public"."vendor_invoice" ADD CONSTRAINT "vendor_invoice_status_check" CHECK ((status = ANY (ARRAY['DRAFT'::text, 'BOOKED'::text, 'PARTIALLY_PAID'::text, 'PAID'::text, 'CANCELLED'::text])));
ALTER TABLE "public"."vendor_invoice_grn_match" ADD CONSTRAINT "chk_vendor_invoice_grn_match_quantity" CHECK ((matched_quantity > (0)::numeric));
ALTER TABLE "public"."vendor_invoice_item" ADD CONSTRAINT "vendor_invoice_item_quantity_check" CHECK ((quantity >= (0)::numeric));
ALTER TABLE "public"."vendor_invoice_item" ADD CONSTRAINT "vendor_invoice_item_unit_price_check" CHECK ((unit_price >= (0)::numeric));
ALTER TABLE "public"."vendor_ledger" ADD CONSTRAINT "vendor_ledger_credit_amount_check" CHECK ((credit_amount >= (0)::numeric));
ALTER TABLE "public"."vendor_ledger" ADD CONSTRAINT "vendor_ledger_debit_amount_check" CHECK ((debit_amount >= (0)::numeric));
ALTER TABLE "public"."weighbridge_ticket" ADD CONSTRAINT "weighbridge_ticket_check" CHECK ((gross_weight_kg >= tare_weight_kg));
ALTER TABLE "public"."weighbridge_ticket" ADD CONSTRAINT "weighbridge_ticket_check1" CHECK (((grn_id IS NOT NULL) OR (delivery_id IS NOT NULL) OR (job_work_challan_id IS NOT NULL)));
ALTER TABLE "public"."weighbridge_ticket" ADD CONSTRAINT "weighbridge_ticket_gross_weight_kg_check" CHECK ((gross_weight_kg >= (0)::numeric));
ALTER TABLE "public"."weighbridge_ticket" ADD CONSTRAINT "weighbridge_ticket_tare_weight_kg_check" CHECK ((tare_weight_kg >= (0)::numeric));
ALTER TABLE "public"."work_order" ADD CONSTRAINT "work_order_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'RUNNING'::text, 'COMPLETED'::text, 'HOLD'::text, 'CANCELLED'::text])));

-- HMFL existing partial unique inventory indexes
-- These are required because inventory_stock.lot_id is nullable.

CREATE UNIQUE INDEX uq_inventory_stock_item_warehouse_lot ON public.inventory_stock USING btree (inventory_item_id, warehouse_id, lot_id) WHERE (lot_id IS NOT NULL);
CREATE UNIQUE INDEX uq_inventory_stock_item_warehouse_no_lot ON public.inventory_stock USING btree (inventory_item_id, warehouse_id) WHERE (lot_id IS NULL);
