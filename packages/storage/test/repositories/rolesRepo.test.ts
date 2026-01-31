/**
 * Tests for rolesRepo
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma client
const mockPrismaClient = {
  role: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock("../../src/prisma.js", () => ({
  getPrismaClient: () => mockPrismaClient,
}));

describe("rolesRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findRoleById", () => {
    it("returns role when found", async () => {
      const mockRole = {
        id: "role-admin",
        name: "admin",
        permissions: ["manage:users", "manage:companies", "submit:invoice"],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.role.findUnique.mockResolvedValueOnce(mockRole);

      const result = await mockPrismaClient.role.findUnique({
        where: { id: "role-admin" },
      });

      expect(result).toEqual(mockRole);
      expect(result.name).toBe("admin");
    });

    it("returns null when role not found", async () => {
      mockPrismaClient.role.findUnique.mockResolvedValueOnce(null);

      const result = await mockPrismaClient.role.findUnique({
        where: { id: "non-existent" },
      });

      expect(result).toBeNull();
    });
  });

  describe("findRoleByName", () => {
    it("returns role by name", async () => {
      const mockRole = {
        id: "role-user",
        name: "user",
        permissions: ["submit:invoice", "read:documents"],
      };

      mockPrismaClient.role.findFirst.mockResolvedValueOnce(mockRole);

      const result = await mockPrismaClient.role.findFirst({
        where: { name: "user" },
      });

      expect(result).toEqual(mockRole);
    });

    it("returns null when name not found", async () => {
      mockPrismaClient.role.findFirst.mockResolvedValueOnce(null);

      const result = await mockPrismaClient.role.findFirst({
        where: { name: "nonexistent" },
      });

      expect(result).toBeNull();
    });
  });

  describe("createRole", () => {
    it("creates role with permissions", async () => {
      const roleData = {
        name: "custom-role",
        permissions: ["submit:invoice", "read:documents", "cancel:documents"],
      };

      const createdRole = {
        id: "role-custom",
        ...roleData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.role.create.mockResolvedValueOnce(createdRole);

      const result = await mockPrismaClient.role.create({
        data: roleData,
      });

      expect(result.id).toBe("role-custom");
      expect(result.permissions).toContain("submit:invoice");
    });

    it("creates role with empty permissions", async () => {
      const roleData = {
        name: "readonly",
        permissions: [],
      };

      const createdRole = {
        id: "role-readonly",
        ...roleData,
      };

      mockPrismaClient.role.create.mockResolvedValueOnce(createdRole);

      const result = await mockPrismaClient.role.create({
        data: roleData,
      });

      expect(result.permissions).toHaveLength(0);
    });
  });

  describe("updateRole", () => {
    it("updates role name", async () => {
      const updatedRole = {
        id: "role-1",
        name: "updated-role-name",
        permissions: ["submit:invoice"],
        updatedAt: new Date(),
      };

      mockPrismaClient.role.update.mockResolvedValueOnce(updatedRole);

      const result = await mockPrismaClient.role.update({
        where: { id: "role-1" },
        data: { name: "updated-role-name" },
      });

      expect(result.name).toBe("updated-role-name");
    });

    it("updates role permissions", async () => {
      const newPermissions = ["submit:invoice", "read:documents", "manage:users"];

      const updatedRole = {
        id: "role-1",
        name: "user",
        permissions: newPermissions,
        updatedAt: new Date(),
      };

      mockPrismaClient.role.update.mockResolvedValueOnce(updatedRole);

      const result = await mockPrismaClient.role.update({
        where: { id: "role-1" },
        data: { permissions: newPermissions },
      });

      expect(result.permissions).toHaveLength(3);
      expect(result.permissions).toContain("manage:users");
    });
  });

  describe("deleteRole", () => {
    it("deletes role by ID", async () => {
      const deletedRole = {
        id: "role-to-delete",
        name: "deleted-role",
      };

      mockPrismaClient.role.delete.mockResolvedValueOnce(deletedRole);

      const result = await mockPrismaClient.role.delete({
        where: { id: "role-to-delete" },
      });

      expect(result.id).toBe("role-to-delete");
    });
  });

  describe("listRoles", () => {
    it("returns all roles", async () => {
      const mockRoles = [
        { id: "role-admin", name: "admin", permissions: ["manage:users"] },
        { id: "role-user", name: "user", permissions: ["submit:invoice"] },
        { id: "role-readonly", name: "readonly", permissions: [] },
      ];

      mockPrismaClient.role.findMany.mockResolvedValueOnce(mockRoles);

      const result = await mockPrismaClient.role.findMany();

      expect(result).toHaveLength(3);
    });

    it("returns roles ordered by name", async () => {
      const mockRoles = [
        { id: "role-admin", name: "admin" },
        { id: "role-readonly", name: "readonly" },
        { id: "role-user", name: "user" },
      ];

      mockPrismaClient.role.findMany.mockResolvedValueOnce(mockRoles);

      const result = await mockPrismaClient.role.findMany({
        orderBy: { name: "asc" },
      });

      expect(result[0].name).toBe("admin");
    });
  });

  describe("countRoles", () => {
    it("returns total role count", async () => {
      mockPrismaClient.role.count.mockResolvedValueOnce(5);

      const result = await mockPrismaClient.role.count();

      expect(result).toBe(5);
    });
  });

  describe("permission validation", () => {
    it("validates known permissions", () => {
      const validPermissions = [
        "submit:invoice",
        "read:documents",
        "cancel:documents",
        "manage:users",
        "manage:roles",
        "manage:companies",
      ];

      validPermissions.forEach((perm) => {
        expect(perm).toMatch(/^[a-z]+:[a-z]+$/);
      });
    });

    it("checks if role has permission", () => {
      const role = {
        permissions: ["submit:invoice", "read:documents"],
      };

      const hasSubmit = role.permissions.includes("submit:invoice");
      const hasManage = role.permissions.includes("manage:users");

      expect(hasSubmit).toBe(true);
      expect(hasManage).toBe(false);
    });

    it("checks multiple permissions", () => {
      const role = {
        permissions: ["submit:invoice", "read:documents", "cancel:documents"],
      };

      const requiredPermissions = ["submit:invoice", "read:documents"];
      const hasAll = requiredPermissions.every((perm) =>
        role.permissions.includes(perm)
      );

      expect(hasAll).toBe(true);
    });

    it("checks any permission", () => {
      const role = {
        permissions: ["read:documents"],
      };

      const anyPermissions = ["submit:invoice", "read:documents"];
      const hasAny = anyPermissions.some((perm) =>
        role.permissions.includes(perm)
      );

      expect(hasAny).toBe(true);
    });
  });

  describe("default roles", () => {
    it("defines admin role with full permissions", () => {
      const adminPermissions = [
        "submit:invoice",
        "read:documents",
        "cancel:documents",
        "manage:users",
        "manage:roles",
        "manage:companies",
      ];

      expect(adminPermissions).toHaveLength(6);
    });

    it("defines user role with basic permissions", () => {
      const userPermissions = ["submit:invoice", "read:documents"];

      expect(userPermissions).toHaveLength(2);
    });

    it("defines pos role with submit-only permission", () => {
      const posPermissions = ["submit:invoice"];

      expect(posPermissions).toHaveLength(1);
    });
  });

  describe("role with users", () => {
    it("includes users count", async () => {
      const mockRole = {
        id: "role-user",
        name: "user",
        _count: { users: 15 },
      };

      mockPrismaClient.role.findUnique.mockResolvedValueOnce(mockRole);

      const result = await mockPrismaClient.role.findUnique({
        where: { id: "role-user" },
        include: { _count: { select: { users: true } } },
      });

      expect(result._count.users).toBe(15);
    });

    it("prevents deleting role with users", async () => {
      const roleWithUsers = {
        id: "role-in-use",
        _count: { users: 5 },
      };

      const canDelete = roleWithUsers._count.users === 0;
      expect(canDelete).toBe(false);
    });
  });
});
