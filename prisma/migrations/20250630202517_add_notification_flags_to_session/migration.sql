-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "campaignId" INTEGER NOT NULL,
    "dateTime" DATETIME NOT NULL,
    "priorityDropNotified" BOOLEAN NOT NULL DEFAULT false,
    "confirmationRequested" BOOLEAN NOT NULL DEFAULT false,
    "nonPriorityDropNotified" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Session_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("campaignId", "dateTime", "id") SELECT "campaignId", "dateTime", "id" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
