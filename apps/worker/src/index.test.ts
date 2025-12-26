import { describe, it, expect } from "vitest";
import { getWorkerName, getWorkerVersion } from "./index.js";

describe("worker", () => {
  it("should return worker name", () => {
    expect(getWorkerName()).toBe("myinvois-worker");
  });

  it("should return worker version", () => {
    expect(getWorkerVersion()).toBe("0.1.0");
  });
});
