import os from "node:os";

export interface ServerCapacity {
  cpuThreads: number;
  memoryGb: number;
  maxConcurrentLlm: number;
  activeLlm: number;
  availableSlots: number;
}

const cpuThreads = Math.max(1, os.availableParallelism?.() || os.cpus().length || 1);
const memoryGb = os.totalmem() / 1024 ** 3;
const configuredLimit = Number(process.env.MAX_CONCURRENT_LLM || 0);
const automaticLimit = Math.max(1, Math.min(8, Math.floor(cpuThreads / 2), Math.floor(memoryGb / 4)));
const maxConcurrentLlm = Number.isFinite(configuredLimit) && configuredLimit > 0
  ? Math.max(1, Math.min(32, Math.floor(configuredLimit)))
  : automaticLimit;

let activeLlm = 0;

export function tryAcquireLlmSlot(): boolean {
  if (activeLlm >= maxConcurrentLlm) return false;
  activeLlm += 1;
  return true;
}

export function releaseLlmSlot(): void {
  activeLlm = Math.max(0, activeLlm - 1);
}

export function getServerCapacity(): ServerCapacity {
  return {
    cpuThreads,
    memoryGb: Math.round(memoryGb * 10) / 10,
    maxConcurrentLlm,
    activeLlm,
    availableSlots: Math.max(0, maxConcurrentLlm - activeLlm),
  };
}