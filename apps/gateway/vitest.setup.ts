/**
 * Vitest setup file for gateway tests
 * Configures the database connection for tests
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set DATABASE_URL to use the storage package's dev database
// This allows tests to use the same schema/migrations
if (!process.env.DATABASE_URL) {
  const dbPath = resolve(__dirname, "../../packages/storage/prisma/dev.db");
  process.env.DATABASE_URL = `file:${dbPath}`;
}
