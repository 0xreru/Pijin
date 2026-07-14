-- CreateTable
CREATE TABLE "online_transfer" (
    "id" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "sender_public_key" TEXT NOT NULL,
    "recipient_public_key" TEXT NOT NULL,
    "token_id" INTEGER NOT NULL,
    "amount_stroops" BIGINT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "online_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "online_transfer_tx_hash_key" ON "online_transfer"("tx_hash");

-- CreateIndex
CREATE INDEX "online_transfer_sender_public_key_created_at_idx"
ON "online_transfer"("sender_public_key", "created_at");

-- CreateIndex
CREATE INDEX "online_transfer_recipient_public_key_created_at_idx"
ON "online_transfer"("recipient_public_key", "created_at");

-- AddForeignKey
ALTER TABLE "online_transfer"
ADD CONSTRAINT "online_transfer_token_id_fkey"
FOREIGN KEY ("token_id") REFERENCES "token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
