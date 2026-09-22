-- CreateTable
CREATE TABLE "clara_catalog_products" (
    "handle" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "availableForSale" BOOLEAN NOT NULL,
    "shopifyUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clara_catalog_products_pkey" PRIMARY KEY ("shopifyProductId")
);

-- CreateTable
CREATE TABLE "clara_catalog_state" (
    "source" TEXT NOT NULL,
    "productCount" INTEGER NOT NULL,
    "catalogFingerprint" TEXT NOT NULL,
    "lastShopifyUpdatedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clara_catalog_state_pkey" PRIMARY KEY ("source")
);

-- CreateIndex
CREATE UNIQUE INDEX "clara_catalog_products_handle_key" ON "clara_catalog_products"("handle");

-- CreateIndex
CREATE INDEX "clara_catalog_products_availableForSale_idx" ON "clara_catalog_products"("availableForSale");

-- CreateIndex
CREATE INDEX "clara_catalog_products_shopifyUpdatedAt_idx" ON "clara_catalog_products"("shopifyUpdatedAt");
