-- CreateTable
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "shortId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "stellarPublicKey" TEXT NOT NULL,
    "offlineDeviceKey" TEXT,
    "merchantPin" TEXT,
    "merchantPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" SERIAL NOT NULL,
    "customerShortId" TEXT NOT NULL,
    "merchantShortId" TEXT NOT NULL,
    "amountXlm" TEXT NOT NULL,
    "txHash" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_shortId_key" ON "Account"("shortId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_stellarPublicKey_key" ON "Account"("stellarPublicKey");
