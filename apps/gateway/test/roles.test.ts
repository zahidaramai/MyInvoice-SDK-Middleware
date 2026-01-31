/**
 * TST-03: Role Management API Tests
 * Tests for roles CRUD endpoints
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
    createRole: vi.fn(),
    findRoleById: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    listRoles: vi.fn(),
    getAllRoles: vi.fn(),
    roleNameExists: vi.fn(),
    roleHasUsers: vi.fn(),
    parsePermissions: vi.fn((role) => {
      if (typeof role.permissions === "string") {
        try {
          return JSON.parse(role.permissions);
        } catch {
          return [];
        }
      }
      return role.permissions || [];
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

// Mock JWT functions
vi.mock("../src/auth/jwt.js", () => ({
  verifyAccessToken: vi.fn((token: string) => {
    if (token === "valid-admin-token") {
      return {
        userId: "admin-user-123",
        email: "admin@example.com",
        companyId: "company-123",
        permissions: ["manage:roles", "read:documents"],
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
const mockRole = {
  id: "role-123",
  name: "Admin",
  permissions: '["submit:invoice","read:documents"]',
  description: "Admin role",
  userCount: 5,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSuperadminRole = {
  id: "superadmin-role",
  name: "Superadmin",
  permissions: '["*"]',
  description: "Superadmin role",
  userCount: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockRoleList = {
  data: [mockRole],
  total: 1,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const VALID_ADMIN_TOKEN = "valid-admin-token";

describe("TST-03: Role Management API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /api/v1/roles", () => {
    it("should list roles with pagination", async () => {
      vi.mocked(storage.listRoles).mockResolvedValue(mockRoleList as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/roles",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.data.length).toBe(1);
      expect(body.data[0].name).toBe("Admin");
      expect(body.pagination.total).toBe(1);
    });

    it("should filter out Superadmin role from listing", async () => {
      vi.mocked(storage.listRoles).mockResolvedValue({
        data: [mockRole, mockSuperadminRole],
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      } as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/roles",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].name).toBe("Admin");
    });

    it("should return 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/roles",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /api/v1/roles/all", () => {
    it("should return all roles for dropdowns", async () => {
      vi.mocked(storage.getAllRoles).mockResolvedValue([mockRole] as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/roles/all",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toBeDefined();
      expect(body.data.length).toBe(1);
    });

    it("should filter out Superadmin role", async () => {
      vi.mocked(storage.getAllRoles).mockResolvedValue([mockRole, mockSuperadminRole] as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/roles/all",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.length).toBe(1);
      expect(body.data[0].name).toBe("Admin");
    });
  });

  describe("GET /api/v1/roles/permissions", () => {
    it("should return available permissions", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/roles/permissions",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.permissions).toBeDefined();
      expect(body.permissions).toContain("submit:invoice");
      expect(body.permissions).toContain("manage:users");
      expect(body.permissions).not.toContain("*"); // Superadmin permission excluded
    });
  });

  describe("GET /api/v1/roles/:id", () => {
    it("should return role by ID", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockRole as any);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/roles/role-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe("role-123");
      expect(body.name).toBe("Admin");
    });

    it("should return 404 for non-existent role", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(null);

      const response = await app.inject({
        method: "GET",
        url: "/api/v1/roles/nonexistent",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error.code).toBe("ROLE_NOT_FOUND");
    });
  });

  describe("POST /api/v1/roles", () => {
    it("should create a new role", async () => {
      vi.mocked(storage.roleNameExists).mockResolvedValue(false);
      vi.mocked(storage.createRole).mockResolvedValue(mockRole as any);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Editor",
          permissions: ["submit:invoice", "read:documents"],
          description: "Editor role",
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe("Admin");
    });

    it("should return 400 for duplicate role name", async () => {
      vi.mocked(storage.roleNameExists).mockResolvedValue(true);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Admin",
          permissions: ["read:documents"],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("ROLE_NAME_EXISTS");
    });

    it("should return 400 for invalid permissions", async () => {
      vi.mocked(storage.roleNameExists).mockResolvedValue(false);

      const response = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Editor",
          permissions: ["invalid:permission"],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("INVALID_PERMISSIONS");
    });

    it("should return 403 when trying to create Superadmin role", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Superadmin",
          permissions: ["read:documents"],
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe("SUPERADMIN_PROTECTED");
    });

    it("should return 403 when trying to assign superadmin permission", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/roles",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "SuperRole",
          permissions: ["*"],
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe("SUPERADMIN_PERMISSION_PROTECTED");
    });
  });

  describe("PUT /api/v1/roles/:id", () => {
    it("should update role", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockRole as any);
      vi.mocked(storage.roleNameExists).mockResolvedValue(false);
      vi.mocked(storage.updateRole).mockResolvedValue({
        ...mockRole,
        name: "Updated Role",
      } as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/roles/role-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Updated Role",
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.name).toBe("Updated Role");
    });

    it("should return 404 for non-existent role", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(null);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/roles/nonexistent",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Updated Role",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 403 when trying to modify Superadmin role", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockSuperadminRole as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/roles/superadmin-role",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Updated Role",
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe("SUPERADMIN_PROTECTED");
    });

    it("should return 403 when trying to rename to Superadmin", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockRole as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/roles/role-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Superadmin",
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should return 400 if name taken by another role", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockRole as any);
      vi.mocked(storage.roleNameExists).mockResolvedValue(true);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/roles/role-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          name: "Existing Role",
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("ROLE_NAME_EXISTS");
    });
  });

  describe("PUT /api/v1/roles/:id/permissions", () => {
    it("should update role permissions", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockRole as any);
      vi.mocked(storage.updateRole).mockResolvedValue({
        ...mockRole,
        permissions: '["read:documents","cancel:documents"]',
      } as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/roles/role-123/permissions",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          permissions: ["read:documents", "cancel:documents"],
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should return 404 for non-existent role", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(null);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/roles/nonexistent/permissions",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          permissions: ["read:documents"],
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 403 when trying to modify Superadmin permissions", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockSuperadminRole as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/roles/superadmin-role/permissions",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          permissions: ["read:documents"],
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should return 403 when trying to add superadmin permission", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockRole as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/roles/role-123/permissions",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          permissions: ["*"],
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should return 400 for invalid permissions", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockRole as any);

      const response = await app.inject({
        method: "PUT",
        url: "/api/v1/roles/role-123/permissions",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
        payload: {
          permissions: ["invalid:permission"],
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("INVALID_PERMISSIONS");
    });
  });

  describe("DELETE /api/v1/roles/:id", () => {
    it("should delete role", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockRole as any);
      vi.mocked(storage.roleHasUsers).mockResolvedValue(false);
      vi.mocked(storage.deleteRole).mockResolvedValue(undefined);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/roles/role-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(204);
    });

    it("should return 404 for non-existent role", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(null);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/roles/nonexistent",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 403 when trying to delete Superadmin role", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockSuperadminRole as any);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/roles/superadmin-role",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.error.code).toBe("SUPERADMIN_PROTECTED");
    });

    it("should return 400 when role has assigned users", async () => {
      vi.mocked(storage.findRoleById).mockResolvedValue(mockRole as any);
      vi.mocked(storage.roleHasUsers).mockResolvedValue(true);

      const response = await app.inject({
        method: "DELETE",
        url: "/api/v1/roles/role-123",
        headers: {
          authorization: `Bearer ${VALID_ADMIN_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("ROLE_HAS_USERS");
    });
  });
});
