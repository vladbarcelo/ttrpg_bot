-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Campaign" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "maxTickets" INTEGER NOT NULL,
    "scheduleOrder" INTEGER NOT NULL,
    "dungeonMasterId" INTEGER,
    CONSTRAINT "Campaign_dungeonMasterId_fkey" FOREIGN KEY ("dungeonMasterId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Campaign" ("id", "maxTickets", "name", "scheduleOrder") SELECT "id", "maxTickets", "name", "scheduleOrder" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
CREATE UNIQUE INDEX "Campaign_name_key" ON "Campaign"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
