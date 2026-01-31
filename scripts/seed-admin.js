#!/usr/bin/env node
/**
 * HashLHDN Admin Seeder Script
 *
 * Creates the initial admin user and roles after deployment.
 * This script can be run directly with Node.js (no tsx required).
 *
 * Usage:
 *   node scripts/seed-admin.js
 *
 * Or in EB environment:
 *   npx prisma db seed
 *
 * Environment:
 *   DATABASE_URL must be set
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SALT_ROUNDS = 12;

// Default admin credentials - CHANGE IMMEDIATELY AFTER FIRST LOGIN
const DEFAULT_ADMIN_EMAIL = "admin@hashlhdn.com";
const DEFAULT_ADMIN_PASSWORD = "CHANGE_ME_IMMEDIATELY";

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function seedAdmin() {
  console.log("");
  console.log("========================================");
  console.log("  HashLHDN Admin Seeder");
  console.log("========================================");
  console.log("");

  try {
    // 1. Create Admin Role with all permissions
    console.log("[1/3] Creating admin role...");
    const adminRole = await prisma.role.upsert({
      where: { name: "Admin" },
      update: {},
      create: {
        name: "Admin",
        description: "Full system administrator with all permissions",
        permissions: JSON.stringify([
          "submit:invoice",
          "read:documents",
          "cancel:documents",
          "manage:users",
          "manage:roles",
          "manage:companies",
        ]),
      },
    });
    console.log(`    ✓ Admin role: ${adminRole.id}`);

    // 2. Create additional default roles
    console.log("[2/3] Creating default roles...");

    const invoiceManagerRole = await prisma.role.upsert({
      where: { name: "Invoice Manager" },
      update: {},
      create: {
        name: "Invoice Manager",
        description: "Can submit and manage invoices",
        permissions: JSON.stringify(["submit:invoice", "read:documents", "cancel:documents"]),
      },
    });
    console.log(`    ✓ Invoice Manager role: ${invoiceManagerRole.id}`);

    const viewerRole = await prisma.role.upsert({
      where: { name: "Viewer" },
      update: {},
      create: {
        name: "Viewer",
        description: "Read-only access to documents",
        permissions: JSON.stringify(["read:documents"]),
      },
    });
    console.log(`    ✓ Viewer role: ${viewerRole.id}`);

    // 3. Create Admin User
    console.log("[3/3] Creating admin user...");
    const adminPasswordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);

    const adminUser = await prisma.user.upsert({
      where: { email: DEFAULT_ADMIN_EMAIL },
      update: {},
      create: {
        email: DEFAULT_ADMIN_EMAIL,
        passwordHash: adminPasswordHash,
        name: "System Administrator",
        roleId: adminRole.id,
        isActive: true,
      },
    });
    console.log(`    ✓ Admin user: ${adminUser.email}`);

    console.log("");
    console.log("========================================");
    console.log("  Seeding Complete!");
    console.log("========================================");
    console.log("");
    console.log("Admin Credentials:");
    console.log(`  Email:    ${DEFAULT_ADMIN_EMAIL}`);
    console.log(`  Password: ${DEFAULT_ADMIN_PASSWORD}`);
    console.log("");
    console.log("⚠️  IMPORTANT: Change the password immediately after first login!");
    console.log("");
    console.log("Next Steps:");
    console.log("  1. Login via POST /api/v1/auth/login");
    console.log("  2. Create companies via POST /api/v1/companies");
    console.log("  3. Set MyInvois credentials via PUT /api/v1/companies/:id/credentials");
    console.log("");
  } catch (error) {
    console.error("");
    console.error("========================================");
    console.error("  Seeding Failed!");
    console.error("========================================");
    console.error("");
    console.error("Error:", error.message);
    console.error("");
    console.error("Troubleshooting:");
    console.error("  1. Check DATABASE_URL is set correctly");
    console.error("  2. Ensure database migrations have been run");
    console.error("  3. Check database connectivity");
    console.error("");
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seeder
seedAdmin()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
