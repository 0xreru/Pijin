/*
  Warnings:

  - You are about to drop the `Account` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Settlement` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "Account";

-- DropTable
DROP TABLE "Settlement";

-- CreateTable
CREATE TABLE "account" (
    "id" SERIAL NOT NULL,
    "short_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "stellar_public_key" TEXT NOT NULL,
    "offline_device_key" TEXT,
    "pin" TEXT,
    "phone_number" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_node" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "stellar_public_key" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gateway_node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement" (
    "id" SERIAL NOT NULL,
    "qstash_message_id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "sender_short_id" TEXT NOT NULL,
    "receiver_short_id" TEXT NOT NULL,
    "relayer_address" TEXT,
    "amount_token" TEXT NOT NULL,
    "tx_hash" TEXT,
    "status" TEXT NOT NULL,
    "fail_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_short_id_key" ON "account"("short_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_stellar_public_key_key" ON "account"("stellar_public_key");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_node_stellar_public_key_key" ON "gateway_node"("stellar_public_key");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_qstash_message_id_key" ON "settlement"("qstash_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_nonce_key" ON "settlement"("nonce");
