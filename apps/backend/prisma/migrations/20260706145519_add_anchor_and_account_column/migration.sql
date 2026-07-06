-- CreateEnum
CREATE TYPE "AnchorTxType" AS ENUM ('deposit', 'withdrawal');

-- CreateEnum
CREATE TYPE "AnchorTxStatus" AS ENUM ('incomplete', 'pending_user_transfer_start', 'pending_external', 'completed', 'error');

-- AlterTable
ALTER TABLE "account" ADD COLUMN     "email" TEXT,
ADD COLUMN     "first_name" TEXT,
ADD COLUMN     "last_name" TEXT;

-- CreateTable
CREATE TABLE "anchor_transaction" (
    "id" TEXT NOT NULL,
    "stellar_account" TEXT NOT NULL,
    "type" "AnchorTxType" NOT NULL,
    "status" "AnchorTxStatus" NOT NULL DEFAULT 'incomplete',
    "asset_code" TEXT NOT NULL,
    "amount_in" TEXT,
    "amount_out" TEXT,
    "amount_fee" TEXT,
    "memo" TEXT,
    "memo_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "anchor_transaction_pkey" PRIMARY KEY ("id")
);
