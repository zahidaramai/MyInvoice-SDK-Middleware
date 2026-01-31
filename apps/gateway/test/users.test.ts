/**
 * TST-02: User Management API Tests
 * Tests for users CRUD endpoints
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import * as storage from "@myinvois/storage";

// Mock storage functions
vi.mock("@myinvois/storage", async (importOriginal) => {
  const original = await importOriginal<typeof import("@myinvois/storage")>();
  return {
    ...original,
    listUsers: vi.fn(),
    findUserByIdWithCompanies: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
    emailExists: vi.fn(),
    userExists: vi.fn(),
    roleExists: vi.fn(),
    companyExists: vi.fn(),
    linkUserToCompany: vi.fn(),
    unlinkUserFromCompany: vi.fn(),
    isUserLinkedToCompany: vi.fn(),
    findRoleById: vi.fn(),
    parsePermissions: vi.fn().mockReturnValue(["manage:users", "read:documents"]),
    getPrismaClient: vi.fn().mockReturnValue({
      $transaction: vi.fn((fn) =>
        fn({
          user: {
            create: vi.fn().mockResolvedValue({
              id: "new-user-123",
              email: "newuser@example.com",
              name: "New User",
              roleId: "role-123",
              isActive: true,
              role: { id: "role-123", name: "Admin" },
              createdAt: new Date(),
              updatedAt: new Date(),
            }),
          },
          company: {
            findUnique: vi.fn().mockResolvedValue({ id: "company-123" }),
          },
          userCompany: {
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
        })
      ),
    }),
  };
});

// Mock poll queue
vi.mock("../src/lib/pollQueue.js", () => ({
  POLL_QUEUE_NAME: "poll-submission",
  MIN_POLL_INTERVAL_MS: 3000,
  enqueuePoll: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
  enqueueImmediatePoll: vi.fn().mockResolvedValue({ id: "mock-job-id" }),
  calculatePollDelay: vi.fn().mockReturnValue(3000),
  closePollQueue: vi.fn().mockResolvedValue(undefined),
  getPollQueueStats: vi.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
}));

// Mock password hashing
vi.mock("../src/auth/password.js", () => ({
  hashPassword: vi.fn().mockResolvedValue("$2a$10$hashedpassword"),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

// Mock JWT functions
vi.mock("../src/auth/jwt.js", () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token === "valid-admin-token") {
      return {
        userId: "admin-user-123",
        email: "admin@example.com",
        companyId: "company-123",
        permissions: ["manage:users", "read:documents"],
        type: "access",
      };
    }
    throw new Error("Invalid token");
  }),
  verifyPosToken: vi.fn(() => {
    throw new Error("Not a POS token");
  }),
  verifyRefreshToken: vi.fn(),
  createTokenPair: vi.fn(),
  createAccessToken: vi.fn(),
  hashRefreshToken: vi.fn(),
}));

// Sample test data
const mockUser = {
  id: "user-123",
  email: "test@example.com",
  name: "Test User",
  roleId: "role-123",
  isActive: true,
  role: {
    id: "role-123",
    name: "Admin",
    permissions: '["submit:invoice","read:documents"]',
  },
  companies: [
    {
      company: {
        id: "company-123",
        name: "Test Company",
        tin: "C12345678901",
      },
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockUserList = {
  data: [mockUser],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const VALID_ADMIN_TOKEN = "valid-admin-token";

describe("TST-02: User Management API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/v1/users", () => {
    it("should list users with pagination", async () => {
      vi.mocked(storage.listUsers).mockResolvedValue(mockUserList as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.data.length).toBe(1);
      expect(body.data[0].email).toBe("test@example.com");
      expect(body.pagination.total).toBe(1);
    });

    it("should return 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users",
      });

      expect(response.statusCode).toBe(401);
    });

    it("should filter by roleId", async () => {
      vi.mocked(storage.listUsers).mockResolvedValue(mockUserList as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users?roleId=role-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(storage.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ roleId: "role-123" })
      );
    });

    it("should filter by isActive", async () => {
      vi.mocked(storage.listUsers).mockResolvedValue(mockUserList as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users?isActive=true",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(storage.listUsers).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));
    });
  });

  describe("GET /api/v1/users/:id", () => {
    it("should return user by ID", async () => {
      vi.mocked(storage.findUserByIdWithCompanies).mockResolvedValue(mockUser as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users/user-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe("user-123");
      expect(body.email).toBe("test@example.com");
      expect(body.companies).toBeDefined();
    });

    it("should return 404 for non-existent user", async () => {
      vi.mocked(storage.findUserByIdWithCompanies).mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/users/nonexistent",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("USER_NOT_FOUND");
    });
  });

  describe("POST /api/v1/users", () => {
    it("should create a new user", async () => {
      vi.mocked(storage.emailExists).mockResolvedValue(false);
      vi.mocked(storage.roleExists).mockResolvedValue(true);
      vi.mocked(storage.findRoleById).mockResolvedValue({
        id: "role-123",
        name: "Admin",
        permissions: '["submit:invoice"]',
      } as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          email: "newuser@example.com",
          password: "password123",
          name: "New User",
          roleId: "role-123",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.email).toBe("newuser@example.com");
    });

    it("should return 400 for duplicate email", async () => {
      vi.mocked(storage.emailExists).mockResolvedValue(true);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          email: "existing@example.com",
          password: "password123",
          name: "New User",
          roleId: "role-123",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("EMAIL_EXISTS");
    });

    it("should return 400 for non-existent role", async () => {
      vi.mocked(storage.emailExists).mockResolvedValue(false);
      vi.mocked(storage.roleExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          email: "newuser@example.com",
          password: "password123",
          name: "New User",
          roleId: "nonexistent-role",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("ROLE_NOT_FOUND");
    });

    it("should return 403 when trying to assign Superadmin role", async () => {
      vi.mocked(storage.emailExists).mockResolvedValue(false);
      vi.mocked(storage.roleExists).mockResolvedValue(true);
      vi.mocked(storage.findRoleById).mockResolvedValue({
        id: "superadmin-role",
        name: "Superadmin",
        permissions: '["*"]',
      } as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          email: "newuser@example.com",
          password: "password123",
          name: "New User",
          roleId: "superadmin-role",
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe("SUPERADMIN_PROTECTED");
    });

    it("should return 400 for missing required fields", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          email: "newuser@example.com",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return 400 for invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          email: "not-an-email",
          password: "password123",
          name: "New User",
          roleId: "role-123",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("PUT /api/v1/users/:id", () => {
    it("should update user", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(true);
      vi.mocked(storage.emailExists).mockResolvedValue(false);
      vi.mocked(storage.updateUser).mockResolvedValue({
        ...mockUser,
        name: "Updated Name",
      } as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/users/user-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Updated Name",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe("Updated Name");
    });

    it("should return 404 for non-existent user", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/users/nonexistent",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Updated Name",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 400 if email taken by another user", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(true);
      vi.mocked(storage.emailExists).mockResolvedValue(true);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/users/user-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          email: "taken@example.com",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("EMAIL_EXISTS");
    });
  });

  describe("DELETE /api/v1/users/:id", () => {
    it("should delete user", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(true);
      vi.mocked(storage.deleteUser).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/users/user-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(204);
    });

    it("should return 404 for non-existent user", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/users/nonexistent",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 400 when trying to delete self", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(true);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/users/admin-user-123", // Same as authenticated user
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("CANNOT_DELETE_SELF");
    });
  });

  describe("POST /api/v1/users/:id/companies/:companyId", () => {
    it("should link user to company", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(true);
      vi.mocked(storage.companyExists).mockResolvedValue(true);
      vi.mocked(storage.isUserLinkedToCompany).mockResolvedValue(false);
      vi.mocked(storage.linkUserToCompany).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users/user-123/companies/company-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().message).toContain("linked");
    });

    it("should return 404 if user not found", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users/nonexistent/companies/company-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 404 if company not found", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(true);
      vi.mocked(storage.companyExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users/user-123/companies/nonexistent",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 400 if already linked", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(true);
      vi.mocked(storage.companyExists).mockResolvedValue(true);
      vi.mocked(storage.isUserLinkedToCompany).mockResolvedValue(true);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/users/user-123/companies/company-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("ALREADY_LINKED");
    });
  });

  describe("DELETE /api/v1/users/:id/companies/:companyId", () => {
    it("should unlink user from company", async () => {
      vi.mocked(storage.isUserLinkedToCompany).mockResolvedValue(true);
      vi.mocked(storage.unlinkUserFromCompany).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/users/user-123/companies/company-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(204);
    });

    it("should return 404 if not linked", async () => {
      vi.mocked(storage.isUserLinkedToCompany).mockResolvedValue(false);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/users/user-123/companies/company-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("NOT_LINKED");
    });
  });

  describe("PUT /api/v1/users/:id/role", () => {
    it("should assign role to user", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(true);
      vi.mocked(storage.roleExists).mockResolvedValue(true);
      vi.mocked(storage.findRoleById).mockResolvedValue({
        id: "new-role",
        name: "Viewer",
        permissions: '["read:documents"]',
      } as any);
      vi.mocked(storage.updateUser).mockResolvedValue({
        ...mockUser,
        roleId: "new-role",
        role: { id: "new-role", name: "Viewer" },
      } as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/users/user-123/role",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          roleId: "new-role",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.role.id).toBe("new-role");
    });

    it("should return 404 if user not found", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/users/nonexistent/role",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          roleId: "new-role",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 400 if role not found", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(true);
      vi.mocked(storage.roleExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/users/user-123/role",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          roleId: "nonexistent-role",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should return 403 when trying to assign Superadmin role", async () => {
      vi.mocked(storage.userExists).mockResolvedValue(true);
      vi.mocked(storage.roleExists).mockResolvedValue(true);
      vi.mocked(storage.findRoleById).mockResolvedValue({
        id: "superadmin-role",
        name: "Superadmin",
        permissions: '["*"]',
      } as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/users/user-123/role",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          roleId: "superadmin-role",
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe("SUPERADMIN_PROTECTED");
    });
  });
});
