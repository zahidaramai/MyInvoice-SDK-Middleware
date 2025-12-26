import { describe, it, expect } from "vitest";
import { getWorkerName, getWorkerVersion, WORKER_NAME, WORKER_VERSION } from "./index.js";

describe("worker", () => {
  it("should return worker name", () => {
    expect(getWorkerName()).toBe(WORKER_NAME);
  });

  it("should return worker version", () => {
    expect(getWorkerVersion()).toBe(WORKER_VERSION);
  });
});
