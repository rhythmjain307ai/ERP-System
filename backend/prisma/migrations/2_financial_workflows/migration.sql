-- AlterTable
ALTER TABLE "accounting_entry" ADD COLUMN     "reversal_of_id" BIGINT;

-- AlterTable
ALTER TABLE "accounts_payable" ADD COLUMN     "created_at" TIMESTAMPTZ(6),
ADD COLUMN     "created_by" BIGINT;

-- AlterTable
ALTER TABLE "bank_account" ADD COLUMN     "gl_account_id" BIGINT;

-- AlterTable
ALTER TABLE "bank_transaction" ADD COLUMN     "matched_at" TIMESTAMPTZ(6),
ADD COLUMN     "matched_by" BIGINT,
ADD COLUMN     "reconciled_at" TIMESTAMPTZ(6),
ADD COLUMN     "reconciled_by" BIGINT,
ADD COLUMN     "reconciliation_status" TEXT NOT NULL DEFAULT 'UNRECONCILED';

-- AlterTable
ALTER TABLE "journal_entry" ADD COLUMN     "reversal_of_id" BIGINT;

-- AlterTable
ALTER TABLE "payment" ADD COLUMN     "created_at" TIMESTAMPTZ(6),
ADD COLUMN     "created_by" BIGINT,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMPTZ(6),
ADD COLUMN     "reversed_by" BIGINT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'CREATED';

-- AlterTable
ALTER TABLE "vendor_invoice" ADD COLUMN     "booked_at" TIMESTAMPTZ(6),
ADD COLUMN     "booked_by" BIGINT,
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(6),
ADD COLUMN     "cancelled_by" BIGINT,
ADD COLUMN     "created_at" TIMESTAMPTZ(6),
ADD COLUMN     "created_by" BIGINT,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMPTZ(6),
ADD COLUMN     "reversed_by" BIGINT;

-- AlterTable
ALTER TABLE "payment_allocation" ADD COLUMN     "created_by" BIGINT,
ADD COLUMN     "reversal_reason" TEXT,
ADD COLUMN     "reversed_at" TIMESTAMPTZ(6),
ADD COLUMN     "reversed_by" BIGINT;

-- CreateTable
CREATE TABLE "company_finance_config" (
    "company_id" BIGINT NOT NULL,
    "inventory_account_id" BIGINT NOT NULL,
    "expense_account_id" BIGINT NOT NULL,
    "input_cgst_account_id" BIGINT NOT NULL,
    "input_sgst_account_id" BIGINT NOT NULL,
    "input_igst_account_id" BIGINT NOT NULL,
    "input_cess_account_id" BIGINT NOT NULL,
    "payable_account_id" BIGINT NOT NULL,
    "cash_account_id" BIGINT NOT NULL,
    "rounding_account_id" BIGINT NOT NULL,

    CONSTRAINT "company_finance_config_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entry_reversal_of_id_key" ON "accounting_entry"("reversal_of_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_entry_company_id_source_type_source_id_key" ON "accounting_entry"("company_id", "source_type", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transaction_payment_id_key" ON "bank_transaction"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entry_reversal_of_id_key" ON "journal_entry"("reversal_of_id");

-- AddForeignKey
ALTER TABLE "accounting_entry" ADD CONSTRAINT "accounting_entry_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "accounting_entry"("accounting_entry_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "accounts_payable" ADD CONSTRAINT "accounts_payable_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_gl_account_id_fkey" FOREIGN KEY ("gl_account_id") REFERENCES "chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_reconciled_by_fkey" FOREIGN KEY ("reconciled_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_matched_by_fkey" FOREIGN KEY ("matched_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "journal_entry"("journal_entry_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice" ADD CONSTRAINT "vendor_invoice_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice" ADD CONSTRAINT "vendor_invoice_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice" ADD CONSTRAINT "vendor_invoice_booked_by_fkey" FOREIGN KEY ("booked_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_invoice" ADD CONSTRAINT "vendor_invoice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_reversed_by_fkey" FOREIGN KEY ("reversed_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_finance_config" ADD CONSTRAINT "company_finance_config_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_finance_config" ADD CONSTRAINT "company_finance_config_inventory_account_id_fkey" FOREIGN KEY ("inventory_account_id") REFERENCES "chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_finance_config" ADD CONSTRAINT "company_finance_config_expense_account_id_fkey" FOREIGN KEY ("expense_account_id") REFERENCES "chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_finance_config" ADD CONSTRAINT "company_finance_config_input_cgst_account_id_fkey" FOREIGN KEY ("input_cgst_account_id") REFERENCES "chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_finance_config" ADD CONSTRAINT "company_finance_config_input_sgst_account_id_fkey" FOREIGN KEY ("input_sgst_account_id") REFERENCES "chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_finance_config" ADD CONSTRAINT "company_finance_config_input_igst_account_id_fkey" FOREIGN KEY ("input_igst_account_id") REFERENCES "chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_finance_config" ADD CONSTRAINT "company_finance_config_input_cess_account_id_fkey" FOREIGN KEY ("input_cess_account_id") REFERENCES "chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_finance_config" ADD CONSTRAINT "company_finance_config_payable_account_id_fkey" FOREIGN KEY ("payable_account_id") REFERENCES "chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_finance_config" ADD CONSTRAINT "company_finance_config_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_finance_config" ADD CONSTRAINT "company_finance_config_rounding_account_id_fkey" FOREIGN KEY ("rounding_account_id") REFERENCES "chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Existing rows retain unknown actor/timestamp values. Never invent historical actors.
ALTER TABLE "payment" ADD CONSTRAINT "payment_status_check" CHECK (status IN ('CREATED', 'REVERSED'));
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_reconciliation_status_check" CHECK (reconciliation_status IN ('UNRECONCILED','MATCHED','RECONCILED'));
