import { describe, it, expect } from "vitest";
import { getPackageInfo, PACKAGE_NAME, PACKAGE_VERSION } from "./index.js";

describe("@myinvois/storage", () => {
  it("should return package info", () => {
    const info = getPackageInfo();
    expect(info.name).toBe(PACKAGE_NAME);
    expect(info.version).toBe(PACKAGE_VERSION);
  });

  it("should export correct package name", () => {
    expect(PACKAGE_NAME).toBe("@myinvois/storage");
  });
});
