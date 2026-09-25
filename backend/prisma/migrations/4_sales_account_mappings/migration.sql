-- Sales mappings are nullable for existing companies. Sales posting validates them before use.
ALTER TABLE "public"."company_finance_config"
  ADD COLUMN "receivable_account_id" BIGINT,
  ADD COLUMN "sales_revenue_account_id" BIGINT,
  ADD COLUMN "output_cgst_account_id" BIGINT,
  ADD COLUMN "output_sgst_account_id" BIGINT,
  ADD COLUMN "output_igst_account_id" BIGINT,
  ADD COLUMN "output_cess_account_id" BIGINT;

ALTER TABLE "public"."company_finance_config"
  ADD CONSTRAINT "company_finance_config_receivable_account_id_fkey" FOREIGN KEY ("receivable_account_id") REFERENCES "public"."chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "company_finance_config_sales_revenue_account_id_fkey" FOREIGN KEY ("sales_revenue_account_id") REFERENCES "public"."chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "company_finance_config_output_cgst_account_id_fkey" FOREIGN KEY ("output_cgst_account_id") REFERENCES "public"."chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "company_finance_config_output_sgst_account_id_fkey" FOREIGN KEY ("output_sgst_account_id") REFERENCES "public"."chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "company_finance_config_output_igst_account_id_fkey" FOREIGN KEY ("output_igst_account_id") REFERENCES "public"."chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "company_finance_config_output_cess_account_id_fkey" FOREIGN KEY ("output_cess_account_id") REFERENCES "public"."chart_of_account"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;
