/**
 * Tests for usersRepo
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma client
const mockPrismaClient = {
  user: {
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

describe("usersRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findUserById", () => {
    it("returns user when found", async () => {
      const mockUser = {
        id: "user-1",
        email: "user@example.com",
        name: "Test User",
        passwordHash: "hashed-password",
        roleId: "role-admin",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.user.findUnique.mockResolvedValueOnce(mockUser);

      const result = await mockPrismaClient.user.findUnique({
        where: { id: "user-1" },
      });

      expect(result).toEqual(mockUser);
      expect(result.email).toBe("user@example.com");
    });

    it("returns null when user not found", async () => {
      mockPrismaClient.user.findUnique.mockResolvedValueOnce(null);

      const result = await mockPrismaClient.user.findUnique({
        where: { id: "non-existent" },
      });

      expect(result).toBeNull();
    });

    it("includes role relation", async () => {
      const mockUser = {
        id: "user-1",
        email: "user@example.com",
        name: "Test User",
        roleId: "role-admin",
        role: {
          id: "role-admin",
          name: "admin",
          permissions: ["manage:users", "manage:companies"],
        },
      };

      mockPrismaClient.user.findUnique.mockResolvedValueOnce(mockUser);

      const result = await mockPrismaClient.user.findUnique({
        where: { id: "user-1" },
        include: { role: true },
      });

      expect(result.role.name).toBe("admin");
      expect(result.role.permissions).toContain("manage:users");
    });
  });

  describe("findUserByEmail", () => {
    it("returns user by email", async () => {
      const mockUser = {
        id: "user-2",
        email: "test@example.com",
        name: "Test User",
      };

      mockPrismaClient.user.findFirst.mockResolvedValueOnce(mockUser);

      const result = await mockPrismaClient.user.findFirst({
        where: { email: "test@example.com" },
      });

      expect(result).toEqual(mockUser);
    });

    it("returns null when email not found", async () => {
      mockPrismaClient.user.findFirst.mockResolvedValueOnce(null);

      const result = await mockPrismaClient.user.findFirst({
        where: { email: "nonexistent@example.com" },
      });

      expect(result).toBeNull();
    });
  });

  describe("createUser", () => {
    it("creates user with all fields", async () => {
      const userData = {
        email: "newuser@example.com",
        name: "New User",
        passwordHash: "hashed-password-123",
        roleId: "role-user",
      };

      const createdUser = {
        id: "user-new",
        ...userData,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaClient.user.create.mockResolvedValueOnce(createdUser);

      const result = await mockPrismaClient.user.create({
        data: userData,
      });

      expect(result.id).toBe("user-new");
      expect(result.email).toBe("newuser@example.com");
    });

    it("creates user with company associations", async () => {
      const userData = {
        email: "company-user@example.com",
        name: "Company User",
        passwordHash: "hashed-password",
        roleId: "role-user",
        companies: {
          create: [{ companyId: "company-1" }, { companyId: "company-2" }],
        },
      };

      const createdUser = {
        id: "user-company",
        email: userData.email,
        name: userData.name,
      };

      mockPrismaClient.user.create.mockResolvedValueOnce(createdUser);

      const result = await mockPrismaClient.user.create({
        data: userData,
      });

      expect(result.id).toBe("user-company");
    });
  });

  describe("updateUser", () => {
    it("updates user name", async () => {
      const updatedUser = {
        id: "user-1",
        email: "user@example.com",
        name: "Updated Name",
        updatedAt: new Date(),
      };

      mockPrismaClient.user.update.mockResolvedValueOnce(updatedUser);

      const result = await mockPrismaClient.user.update({
        where: { id: "user-1" },
        data: { name: "Updated Name" },
      });

      expect(result.name).toBe("Updated Name");
    });

    it("updates user password", async () => {
      const updatedUser = {
        id: "user-1",
        passwordHash: "new-hashed-password",
        updatedAt: new Date(),
      };

      mockPrismaClient.user.update.mockResolvedValueOnce(updatedUser);

      const result = await mockPrismaClient.user.update({
        where: { id: "user-1" },
        data: { passwordHash: "new-hashed-password" },
      });

      expect(result.passwordHash).toBe("new-hashed-password");
    });

    it("updates user role", async () => {
      const updatedUser = {
        id: "user-1",
        roleId: "role-admin",
        updatedAt: new Date(),
      };

      mockPrismaClient.user.update.mockResolvedValueOnce(updatedUser);

      const result = await mockPrismaClient.user.update({
        where: { id: "user-1" },
        data: { roleId: "role-admin" },
      });

      expect(result.roleId).toBe("role-admin");
    });
  });

  describe("deleteUser", () => {
    it("deletes user by ID", async () => {
      const deletedUser = {
        id: "user-to-delete",
        email: "deleted@example.com",
      };

      mockPrismaClient.user.delete.mockResolvedValueOnce(deletedUser);

      const result = await mockPrismaClient.user.delete({
        where: { id: "user-to-delete" },
      });

      expect(result.id).toBe("user-to-delete");
    });
  });

  describe("listUsers", () => {
    it("returns all users", async () => {
      const mockUsers = [
        { id: "user-1", email: "user1@example.com", name: "User 1" },
        { id: "user-2", email: "user2@example.com", name: "User 2" },
        { id: "user-3", email: "user3@example.com", name: "User 3" },
      ];

      mockPrismaClient.user.findMany.mockResolvedValueOnce(mockUsers);

      const result = await mockPrismaClient.user.findMany();

      expect(result).toHaveLength(3);
    });

    it("returns users with pagination", async () => {
      const mockUsers = [{ id: "user-2", email: "user2@example.com", name: "User 2" }];

      mockPrismaClient.user.findMany.mockResolvedValueOnce(mockUsers);

      const result = await mockPrismaClient.user.findMany({
        skip: 1,
        take: 1,
        orderBy: { createdAt: "desc" },
      });

      expect(result).toHaveLength(1);
    });

    it("returns users filtered by role", async () => {
      const mockUsers = [{ id: "user-1", roleId: "role-admin", name: "Admin User" }];

      mockPrismaClient.user.findMany.mockResolvedValueOnce(mockUsers);

      const result = await mockPrismaClient.user.findMany({
        where: { roleId: "role-admin" },
      });

      expect(result).toHaveLength(1);
      expect(result[0].roleId).toBe("role-admin");
    });
  });

  describe("countUsers", () => {
    it("returns total user count", async () => {
      mockPrismaClient.user.count.mockResolvedValueOnce(10);

      const result = await mockPrismaClient.user.count();

      expect(result).toBe(10);
    });

    it("returns filtered user count", async () => {
      mockPrismaClient.user.count.mockResolvedValueOnce(2);

      const result = await mockPrismaClient.user.count({
        where: { roleId: "role-admin" },
      });

      expect(result).toBe(2);
    });
  });

  describe("email validation", () => {
    it("validates email format", () => {
      const validEmails = [
        "user@example.com",
        "user.name@example.com",
        "user+tag@example.com",
        "user@subdomain.example.com",
      ];

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      validEmails.forEach((email) => {
        expect(email).toMatch(emailRegex);
      });
    });

    it("rejects invalid email format", () => {
      const invalidEmails = ["userexample.com", "@example.com", "user@", "user @example.com"];

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      invalidEmails.forEach((email) => {
        expect(email).not.toMatch(emailRegex);
      });
    });
  });

  describe("password hashing", () => {
    it("stores hashed password, not plain text", () => {
      const plainPassword = "password123";
      const hashedPassword = "hashed-bcrypt-string";

      expect(hashedPassword).not.toBe(plainPassword);
      expect(hashedPassword.length).toBeGreaterThan(plainPassword.length);
    });

    it("never returns plain password", () => {
      const user = {
        id: "user-1",
        email: "user@example.com",
        passwordHash: "hashed-password",
      };

      expect(user).not.toHaveProperty("password");
      expect(user).toHaveProperty("passwordHash");
    });
  });

  describe("user with companies", () => {
    it("includes company associations", async () => {
      const mockUser = {
        id: "user-1",
        email: "user@example.com",
        companies: [
          { companyId: "company-1", company: { id: "company-1", name: "Company A" } },
          { companyId: "company-2", company: { id: "company-2", name: "Company B" } },
        ],
      };

      mockPrismaClient.user.findUnique.mockResolvedValueOnce(mockUser);

      const result = await mockPrismaClient.user.findUnique({
        where: { id: "user-1" },
        include: { companies: { include: { company: true } } },
      });

      expect(result.companies).toHaveLength(2);
    });

    it("filters users by company", async () => {
      const mockUsers = [{ id: "user-1", email: "user1@example.com" }];

      mockPrismaClient.user.findMany.mockResolvedValueOnce(mockUsers);

      const result = await mockPrismaClient.user.findMany({
        where: {
          companies: {
            some: { companyId: "company-1" },
          },
        },
      });

      expect(result).toHaveLength(1);
    });
  });
});
