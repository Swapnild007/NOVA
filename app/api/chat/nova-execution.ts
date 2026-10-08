import type { NovaCapability } from "./nova-capability";
import type { NovaExecutionPlan, NovaToolResult } from "./nova-capability-runtime";

export type NovaExecutionState =
  | "understand"
  | "planned"
  | "awaiting_permission"
  | "executing"
  | "verifying"
  | "completed"
  | "failed"
  | "unverified"
  | "unsupported";

export type NovaExecutionRecord = {
  state: NovaExecutionState;
  capability: NovaCapability;
  tool: string | null;
  startedAt: string;
  completedAt?: string;
  verified: boolean;
  evidence?: unknown;
  error?: string;
};

export function createNovaExecutionRecord(plan: NovaExecutionPlan, capability: NovaCapability): NovaExecutionRecord {
  const now = new Date().toISOString();
  return {
    state: plan.status === "needs_permission"
      ? "awaiting_permission"
      : plan.status === "unsupported"
        ? "unsupported"
        : "planned",
    capability,
    tool: plan.primaryTool,
    startedAt: now,
    verified: false,
    error: plan.status === "unsupported" ? plan.rationale.join("; ") : undefined,
  };
}

export function beginNovaExecution(record: NovaExecutionRecord): NovaExecutionRecord {
  if (record.state !== "planned") return record;
  return { ...record, state: "executing" };
}

export function beginNovaVerification(record: NovaExecutionRecord): NovaExecutionRecord {
  if (record.state !== "executing") return record;
  return { ...record, state: "verifying" };
}

export function completeNovaExecution(record: NovaExecutionRecord, result: NovaToolResult): NovaExecutionRecord {
  const completedAt = new Date().toISOString();
  if (!result.ok) {
    return { ...record, state: "failed", completedAt, verified: false, error: result.error || "Capability execution failed." };
  }
  if (result.verified !== true) {
    return { ...record, state: "unverified", completedAt, verified: false, evidence: result.output, error: "Execution completed without verification evidence." };
  }
  return { ...record, state: "completed", completedAt, verified: true, evidence: result.output };
}

export function isSuccessfulNovaExecution(record: NovaExecutionRecord) {
  return record.state === "completed" && record.verified === true;
}
