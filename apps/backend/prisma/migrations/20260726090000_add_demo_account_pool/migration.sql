-- CreateEnum
CREATE TYPE "DemoPairPurpose" AS ENUM ('JUDGE', 'QA');

-- CreateEnum
CREATE TYPE "DemoPairStatus" AS ENUM ('PROVISIONING', 'READY', 'LEASED', 'FAILED', 'RETIRED');

-- CreateTable
CREATE TABLE "demo_account_pair" (
    "id" TEXT NOT NULL,
    "sender_account_id" INTEGER NOT NULL,
    "receiver_account_id" INTEGER NOT NULL,
    "encrypted_sender_wallet_secret" TEXT NOT NULL,
    "encrypted_receiver_wallet_secret" TEXT NOT NULL,
    "encrypted_sender_device_secret" TEXT NOT NULL,
    "encrypted_receiver_device_secret" TEXT NOT NULL,
    "purpose" "DemoPairPurpose" NOT NULL DEFAULT 'JUDGE',
    "status" "DemoPairStatus" NOT NULL DEFAULT 'PROVISIONING',
    "claimed_by_hash" TEXT,
    "claimed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "last_verified_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demo_account_pair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "demo_account_pair_sender_account_id_key"
ON "demo_account_pair"("sender_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "demo_account_pair_receiver_account_id_key"
ON "demo_account_pair"("receiver_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "demo_account_pair_claimed_by_hash_key"
ON "demo_account_pair"("claimed_by_hash");

-- CreateIndex
CREATE INDEX "demo_account_pair_purpose_status_created_at_idx"
ON "demo_account_pair"("purpose", "status", "created_at");

-- AddForeignKey
ALTER TABLE "demo_account_pair"
ADD CONSTRAINT "demo_account_pair_sender_account_id_fkey"
FOREIGN KEY ("sender_account_id") REFERENCES "account"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_account_pair"
ADD CONSTRAINT "demo_account_pair_receiver_account_id_fkey"
FOREIGN KEY ("receiver_account_id") REFERENCES "account"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
