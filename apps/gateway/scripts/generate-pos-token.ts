#!/usr/bin/env tsx
/**
 * Generate a long-lived POS token for POS system integration
 *
 * Usage:
 *   pnpm --filter @myinvois/gateway tsx scripts/generate-pos-token.ts [options] [userId]
 *
 * Options:
 *   --full-access    Generate token with full access (all permissions)
 *   --permissions    Comma-separated list of permissions (e.g., "submit:invoice,read:documents")
 *
 * Examples:
 *   # Default token with submit:invoice only
 *   pnpm --filter @myinvois/gateway tsx scripts/generate-pos-token.ts
 *
 *   # Full access token (superadmin-like)
 *   pnpm --filter @myinvois/gateway tsx scripts/generate-pos-token.ts --full-access
 *
 *   # Custom permissions
 *   pnpm --filter @myinvois/gateway tsx scripts/generate-pos-token.ts --permissions "submit:invoice,read:documents"
 *
 *   # With custom userId
 *   pnpm --filter @myinvois/gateway tsx scripts/generate-pos-token.ts --full-access pos-example
 *
 * Environment variables required:
 *   JWT_SECRET - The JWT secret used for signing tokens
 *   JWT_REFRESH_SECRET - The refresh token secret (required by jwt.ts but not used)
 *
 * If no userId is provided, a default "pos-system" ID will be used.
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env file from gateway root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Also try loading from project root
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { createPosToken } from "../src/auth/jwt.js";

/**
 * Available permissions in the system
 */
const ALL_PERMISSIONS = [
  "submit:invoice",
  "read:documents",
  "cancel:documents",
  "manage:users",
  "manage:roles",
  "manage:companies",
];

function parseArgs(): { userId: string; permissions: string[] } {
  const args = process.argv.slice(2);
  let userId = "pos-system";
  let permissions: string[] = ["submit:invoice"];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--full-access") {
      // Use wildcard permission for superadmin-like access
      permissions = ["*"];
    } else if (arg === "--permissions") {
      // Next arg should be the permissions list
      const permList = args[i + 1];
      if (permList && !permList.startsWith("--")) {
        permissions = permList.split(",").map((p) => p.trim());
        i++; // Skip the next arg
      }
    } else if (!arg.startsWith("--")) {
      // Assume it's the userId
      userId = arg;
    }
  }

  return { userId, permissions };
}

async function main() {
  // Check for required environment variables
  if (!process.env.JWT_SECRET) {
    console.error("Error: JWT_SECRET environment variable is required");
    console.error("Set it in your .env file or export it in your shell");
    process.exit(1);
  }

  if (!process.env.JWT_REFRESH_SECRET) {
    console.error("Error: JWT_REFRESH_SECRET environment variable is required");
    console.error("Set it in your .env file or export it in your shell");
    process.exit(1);
  }

  const { userId, permissions } = parseArgs();

  console.log("\n=== POS Token Generator ===\n");
  console.log(`User ID: ${userId}`);

  if (permissions.includes("*")) {
    console.log(`Permissions: ["*"] (FULL ACCESS - all endpoints)`);
    console.log("\n⚠️  WARNING: This token has superadmin-level access!");
    console.log("   It can access ALL endpoints without restriction.");
  } else {
    console.log(`Permissions: ${JSON.stringify(permissions)}`);
  }

  // Generate the token
  const { token, expiresAt } = createPosToken(userId, permissions);

  console.log(`\nExpires: ${expiresAt.toISOString()} (10 years from now)`);
  console.log("\n=== Generated Token ===\n");
  console.log(token);
  console.log("\n=== Usage ===\n");
  console.log("1. Add this token to your POS system's .env file:");
  console.log(`   MYINVOIS_API_TOKEN=${token}`);
  console.log("\n2. Use it in API requests:");
  console.log('   curl -X POST "https://localhost:3000/api/v1/pos/invoice" \\');
  console.log(`        -H "Authorization: Bearer ${token.substring(0, 50)}..." \\`);
  console.log('        -H "Content-Type: application/json" \\');
  console.log("        -d '{...}'");

  if (permissions.includes("*")) {
    console.log("\n=== Available Endpoints with Full Access ===\n");
    console.log("  POST   /api/v1/pos/invoice           - Create POS invoice");
    console.log("  GET    /api/v1/documents             - List documents");
    console.log("  GET    /api/v1/documents/:id         - Get document details");
    console.log("  POST   /api/v1/documents/:uuid/cancel - Cancel document");
    console.log("  GET    /api/v1/companies             - List companies");
    console.log("  POST   /api/v1/companies             - Create company");
    console.log("  GET    /api/v1/users                 - List users");
    console.log("  ...and all other protected endpoints");
  }

  console.log("\n");
}

main().catch(console.error);
