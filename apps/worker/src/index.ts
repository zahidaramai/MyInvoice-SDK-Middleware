/**
 * MyInvois Worker - Background Job Processor
 *
 * This is a placeholder entry point.
 * Full implementation (BullMQ polling worker) will be added in Phase 05.
 */

export function getWorkerName(): string {
  return "myinvois-worker";
}

export function getWorkerVersion(): string {
  return "0.1.0";
}

// Placeholder main function
async function main(): Promise<void> {
  console.log(`${getWorkerName()} v${getWorkerVersion()}`);
  console.log("Worker will be implemented in Phase 05");
}

main().catch(console.error);
