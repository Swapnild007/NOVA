import type { CapabilityDecision, NovaCapability } from "./nova-capability";
import { executeNovaCapability, type NovaExecutionPlan, type NovaToolContext, type NovaToolResult } from "./nova-capability-runtime";
import {
  beginNovaExecution,
  beginNovaVerification,
  completeNovaExecution,
  createNovaExecutionRecord,
  type NovaExecutionRecord,
} from "./nova-execution";

export type NovaRunResult = {
  record: NovaExecutionRecord;
  result: NovaToolResult;
};

export async function runNovaCapability(
  decision: CapabilityDecision,
  plan: NovaExecutionPlan,
  context: NovaToolContext,
  permissionGranted = false,
): Promise<NovaRunResult> {
  let record = createNovaExecutionRecord(plan, decision.primary);
  if (record.state !== "planned") {
    return {
      record,
      result: {
        ok: false,
        tool: plan.primaryTool || "none",
        capability: decision.primary,
        error: record.error || "Capability cannot execute.",
        verified: false,
      },
    };
  }

  record = beginNovaExecution(record);
  const result = await executeNovaCapability(plan.primaryTool || "", context, permissionGranted);
  record = beginNovaVerification(record);
  record = completeNovaExecution(record, result);
  return { record, result };
}

export function novaExecutionSummary(record: NovaExecutionRecord) {
  return {
    state: record.state,
    capability: record.capability,
    tool: record.tool,
    verified: record.verified,
    evidence: record.evidence,
    error: record.error,
  };
}
