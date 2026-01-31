-- One-time migration: Add Superadmin role and assign to admin user
-- This should be run manually after deployment via:
-- psql $DATABASE_URL -f packages/storage/prisma/migrations/add_superadmin_role.sql

-- Insert Superadmin role if it doesn't exist
INSERT INTO "Role" (id, name, description, permissions, "createdAt", "updatedAt")
SELECT 
  'superadmin-role-001',
  'Superadmin',
  'Full system access - bypasses all permission and company checks',
  '["*"]',
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE name = 'Superadmin');

-- Update the admin user to have Superadmin role (by email)
UPDATE "User" 
SET "roleId" = (SELECT id FROM "Role" WHERE name = 'Superadmin' LIMIT 1),
    "updatedAt" = NOW()
WHERE email = 'admin@hashlhdn.com';

-- Verify the changes
SELECT u.email, u.name, r.name as role_name, r.permissions
FROM "User" u
JOIN "Role" r ON u."roleId" = r.id
WHERE u.email = 'admin@hashlhdn.com';
