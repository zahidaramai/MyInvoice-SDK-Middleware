/**
 * Vitest setup file for gateway tests
 * Configures the database connection and JWT secrets for tests
 */

// Set DATABASE_URL to use PostgreSQL for tests
// CI uses a service container, locally use the Docker container from docker-compose.yml
if (!process.env.DATABASE_URL) {
  // Default to local Docker PostgreSQL for development
  // CI will override this with the service container URL
  process.env.DATABASE_URL =
    "postgresql://myinvois:myinvois_dev@localhost:5432/myinvois";
}

// Set JWT secrets for testing (TST-01: Auth API tests)
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "test-jwt-secret-for-testing-only-32chars";
}
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = "test-jwt-refresh-secret-for-testing-only";
}
