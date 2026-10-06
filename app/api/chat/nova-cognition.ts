import type { NovaIntent, NovaGatewayPlan } from "./nova-gateway";

export type NovaCognitiveFrame = {
  objective: string;
  mode: NovaIntent;
  requiredCapabilities: string[];
  verification: string[];
};

export function buildCognitiveFrame(
  plan: NovaGatewayPlan,
  objective: string
): NovaCognitiveFrame {
  const capabilities: Record<NovaIntent, string[]> = {
    general: ["reasoning", "conversation"],
    research: ["web research", "source comparison", "citation-aware synthesis"],
    create: ["content generation", "artifact planning"],
    analyze: ["calculation", "structured analysis", "assumption checking"],
    build: ["software design", "implementation", "validation"],
    plan: ["goal decomposition", "dependency mapping", "risk analysis"],
    act: ["permission-aware execution", "verification", "result reporting"],
  };

  const verification: Record<NovaIntent, string[]> = {
    general: ["answer the requested question"],
    research: ["separate evidence from inference", "avoid unsupported current claims"],
    create: ["do not claim an artifact exists unless it was actually produced"],
    analyze: ["check calculations", "state material assumptions"],
    build: ["validate generated structure", "do not claim tests that were not run"],
    plan: ["check dependencies and ordering"],
    act: ["confirm execution result before reporting success"],
  };

  return {
    objective: objective.slice(0, 2000),
    mode: plan.intent,
    requiredCapabilities: capabilities[plan.intent],
    verification: verification[plan.intent],
  };
}

export function buildCognitiveInstruction(frame: NovaCognitiveFrame) {
  return [
    "NOVA Cognitive Loop:",
    "1. Understand the objective.",
    "2. Select the smallest set of capabilities needed.",
    "3. Execute only capabilities actually connected to this runtime.",
    "4. Verify the result against the objective.",
    "5. Report what was done, what was verified, and any remaining limitation.",
    "Mode: " + frame.mode,
    "Required capabilities: " + frame.requiredCapabilities.join(", "),
    "Verification requirements: " + frame.verification.join(", "),
  ].join("\n");
}
