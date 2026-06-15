/*
  Warnings:

  - The `role` column on the `account` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `amount_token` on the `settlement` table. All the data in the column will be lost.
  - Added the required column `amount_stroops` to the `settlement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `token_id` to the `settlement` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `status` on the `settlement` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'SETTLED', 'FAILED');

-- AlterTable
ALTER TABLE "account" DROP COLUMN "role",
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "settlement" DROP COLUMN "amount_token",
ADD COLUMN     "amount_stroops" BIGINT NOT NULL,
ADD COLUMN     "token_id" INTEGER NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "SettlementStatus" NOT NULL;

-- CreateTable
CREATE TABLE "token" (
    "id" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 7,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "token_symbol_key" ON "token"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "token_contract_id_key" ON "token"("contract_id");

-- AddForeignKey
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "token"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
