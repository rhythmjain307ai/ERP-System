-- Align receivable lifecycle names with sales invoice and payment allocation statuses.
UPDATE "public"."accounts_receivable"
SET "status" = CASE
  WHEN "status" = 'PARTIALLY_RECEIVED' THEN 'PARTIALLY_PAID'
  WHEN "status" = 'RECEIVED' THEN 'PAID'
  ELSE "status"
END
WHERE "status" IN ('PARTIALLY_RECEIVED', 'RECEIVED');

ALTER TABLE "public"."accounts_receivable"
  DROP CONSTRAINT "accounts_receivable_status_check";

ALTER TABLE "public"."accounts_receivable"
  ADD CONSTRAINT "accounts_receivable_status_check"
  CHECK ("status" IN ('OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'));
