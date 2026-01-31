/**
 * Database seed script (CommonJS for Node.js compatibility)
 * Creates initial admin user, role, and sample company
 */

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const SALT_ROUNDS = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function main() {
  console.log("Starting database seed...");

  // 1. Create Admin Role with all permissions
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
      permissions: JSON.stringify([
        "submit:invoice",
        "read:documents",
        "cancel:documents",
      ]),
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
      permissions: JSON.stringify([
        "read:documents",
      ]),
    },
  });
  console.log(`Created/updated role: ${viewerRole.name} (${viewerRole.id})`);

  // 4. Create Admin User
  const adminPasswordHash = await hashPassword("admin123");
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@hashlhdn.com" },
    update: {},
    create: {
      email: "admin@hashlhdn.com",
      passwordHash: adminPasswordHash,
      name: "System Administrator",
      roleId: adminRole.id,
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
      myinvoisEnv: "SANDBOX",
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
