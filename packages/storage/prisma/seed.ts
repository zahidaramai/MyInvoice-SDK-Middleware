/**
 * Database seed script
 * Creates initial admin user, role, and sample company
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SALT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function main() {
  console.log("Starting database seed...");

  // 1. Create Superadmin Role with full access
  const superadminRole = await prisma.role.upsert({
    where: { name: "Superadmin" },
    update: {
      permissions: JSON.stringify(["*"]),
    },
    create: {
      name: "Superadmin",
      description: "Full system access - bypasses all permission and company checks",
      permissions: JSON.stringify(["*"]),
    },
  });
  console.log(`Created/updated role: ${superadminRole.name} (${superadminRole.id})`);

  // 2. Create Admin Role with all permissions
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
  console.log(`Created/updated role: ${adminRole.name} (${adminRole.id})`);

  // 2. Create Invoice Manager Role
  const invoiceManagerRole = await prisma.role.upsert({
    where: { name: "Invoice Manager" },
    update: {},
    create: {
      name: "Invoice Manager",
      description: "Can submit and manage invoices",
      permissions: JSON.stringify(["submit:invoice", "read:documents", "cancel:documents"]),
    },
  });
  console.log(`Created/updated role: ${invoiceManagerRole.name} (${invoiceManagerRole.id})`);

  // 3. Create Viewer Role
  const viewerRole = await prisma.role.upsert({
    where: { name: "Viewer" },
    update: {},
    create: {
      name: "Viewer",
      description: "Read-only access to documents",
      permissions: JSON.stringify(["read:documents"]),
    },
  });
  console.log(`Created/updated role: ${viewerRole.name} (${viewerRole.id})`);

  // 5. Create Admin User with Superadmin role
  const adminPasswordHash = await hashPassword("admin123");
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@hashlhdn.com" },
    update: {
      roleId: superadminRole.id, // Upgrade existing admin to superadmin
    },
    create: {
      email: "admin@hashlhdn.com",
      passwordHash: adminPasswordHash,
      name: "System Administrator",
      roleId: superadminRole.id,
      isActive: true,
    },
  });
  console.log(`Created/updated user: ${adminUser.email} (${adminUser.id})`);

  // 5. Create Sample Company
  const sampleCompany = await prisma.company.upsert({
    where: {
      tin_idValue: {
        tin: "C12345678901",
        idValue: "202401234567",
      },
    },
    update: {},
    create: {
      name: "Hashmato Sdn Bhd",
      tin: "C12345678901",
      idValue: "202401234567",
      idType: "BRN",
      isActive: true,
      myinvoisEnv: "PROD",
      // Note: MyInvois credentials should be set via API after deployment
      myinvoisClientId: null,
      myinvoisClientSecret: null,
    },
  });
  console.log(`Created/updated company: ${sampleCompany.name} (${sampleCompany.id})`);

  // 6. Link Admin User to Sample Company
  const existingLink = await prisma.userCompany.findUnique({
    where: {
      userId_companyId: {
        userId: adminUser.id,
        companyId: sampleCompany.id,
      },
    },
  });

  if (!existingLink) {
    await prisma.userCompany.create({
      data: {
        userId: adminUser.id,
        companyId: sampleCompany.id,
      },
    });
    console.log(`Linked user ${adminUser.email} to company ${sampleCompany.name}`);
  } else {
    console.log(`User ${adminUser.email} already linked to company ${sampleCompany.name}`);
  }

  console.log("\n========================================");
  console.log("Database seed completed successfully!");
  console.log("========================================");
  console.log("\nAdmin User Credentials:");
  console.log("  Email: admin@hashlhdn.com");
  console.log("  Password: admin123");
  console.log("\nIMPORTANT: Change the admin password after first login!");
  console.log("\nSample Company:");
  console.log(`  Name: ${sampleCompany.name}`);
  console.log(`  TIN: ${sampleCompany.tin}`);
  console.log(`  ID: ${sampleCompany.id}`);
  console.log("\nNext Steps:");
  console.log("  1. Set MyInvois credentials via PUT /api/v1/companies/:id/credentials");
  console.log("  2. Change admin password via user management");
  console.log("========================================\n");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("Seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
