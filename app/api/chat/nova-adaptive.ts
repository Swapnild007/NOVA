import type { NovaGatewayPlan } from "./nova-gateway";

export type NovaCognitiveDepth = "instant" | "focused" | "deep" | "orchestrated";

export type NovaAdaptiveProfile = {
  depth: NovaCognitiveDepth;
  complexity: number;
  responseStyle: "conversational" | "structured" | "analytical" | "execution";
  needsVerification: boolean;
  needsCurrentContext: boolean;
};

export function buildAdaptiveProfile(plan: NovaGatewayPlan, objective: string): NovaAdaptiveProfile {
  const text = objective.trim();
  let complexity = 0;
  if (text.length > 180) complexity += 2;
  if (text.length > 600) complexity += 2;
  if (/\b(plan|roadmap|strategy|steps|workflow|project|trip|budget|routine|schedule)\b/i.test(text)) complexity += 2;
  if (/\b(compare|choose|best|should|recommend|trade[- ]?off|decision)\b/i.test(text)) complexity += 2;
  if (/\b(calculate|analyze|audit|debug|diagnose|optimize|why)\b/i.test(text)) complexity += 2;
  if (/\b(build|implement|deploy|integrate|automate|execute|book|send|create)\b/i.test(text)) complexity += 2;
  if (/\b(today|now|current|latest|weather|price|availability|news)\b/i.test(text)) complexity += 1;
  if (plan.intent === "research" || plan.intent === "build" || plan.intent === "act") complexity += 2;
  if (plan.deepResearch) complexity += 2;

  const bounded = Math.min(10, complexity);
  const depth: NovaCognitiveDepth =
    bounded >= 8 ? "orchestrated" :
    bounded >= 5 ? "deep" :
    bounded >= 2 ? "focused" :
    "instant";

  const responseStyle =
    plan.intent === "act" ? "execution" :
    plan.intent === "analyze" || plan.intent === "research" ? "analytical" :
    plan.intent === "plan" || bounded >= 5 ? "structured" :
    "conversational";

  return {
    depth,
    complexity: bounded,
    responseStyle,
    needsVerification: bounded >= 4 || ["research", "analyze", "build", "plan", "act"].includes(plan.intent),
    needsCurrentContext: /\b(today|now|current|latest|weather|price|availability|news)\b/i.test(text),
  };
}

export function buildAdaptiveInstruction(profile: NovaAdaptiveProfile) {
  return [
    "NOVA Adaptive Cognition:",
    "Depth: " + profile.depth + " | complexity=" + profile.complexity + "/10 | response=" + profile.responseStyle,
    "Use proportional reasoning. Do not spend deep reasoning on trivial requests.",
    "For deep or orchestrated tasks, decompose internally into objective, constraints, dependencies, execution, verification, and next step.",
    profile.needsVerification ? "Verification is required before presenting a confident conclusion." : "Use a lightweight sanity check before answering.",
    profile.needsCurrentContext ? "Current-world facts must come from connected current context or an available native capability; do not guess freshness." : "",
    "Prefer a concise conversational response unless structure materially improves usability.",
  ].filter(Boolean).join("\n");
}
