-- CreateTable
CREATE TABLE "Settlement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerShortId" TEXT NOT NULL,
    "merchantShortId" TEXT NOT NULL,
    "amountPhp" TEXT NOT NULL,
    "txHash" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
