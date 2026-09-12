-- Net weight is calculated and stored by application logic.
ALTER TABLE "public"."weighbridge_ticket"
  ALTER COLUMN "net_weight_kg" DROP DEFAULT;
