-- Rename column from brn to idValue
-- This is a safe column rename that preserves data

-- Step 1: Drop the unique constraint
ALTER TABLE "Company" DROP CONSTRAINT IF EXISTS "Company_tin_brn_key";

-- Step 2: Drop the index on brn
DROP INDEX IF EXISTS "Company_brn_idx";

-- Step 3: Rename the column
ALTER TABLE "Company" RENAME COLUMN "brn" TO "idValue";

-- Step 4: Recreate the unique constraint with new column name
ALTER TABLE "Company" ADD CONSTRAINT "Company_tin_idValue_key" UNIQUE ("tin", "idValue");

-- Step 5: Recreate the index with new column name
CREATE INDEX "Company_idValue_idx" ON "Company"("idValue");
