CREATE TABLE "TurnosPortalGrant" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurnosPortalGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TurnosPortalGrant_tokenHash_key" ON "TurnosPortalGrant"("tokenHash");
CREATE INDEX "TurnosPortalGrant_userId_expiresAt_idx" ON "TurnosPortalGrant"("userId", "expiresAt");
CREATE INDEX "TurnosPortalGrant_expiresAt_idx" ON "TurnosPortalGrant"("expiresAt");

ALTER TABLE "TurnosPortalGrant" ADD CONSTRAINT "TurnosPortalGrant_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
