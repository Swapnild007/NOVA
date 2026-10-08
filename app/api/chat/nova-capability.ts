import type { NovaIntent } from "./nova-gateway";

export type NovaCapability =
  | "reason"
  | "time"
  | "research"
  | "create"
  | "analyze"
  | "build"
  | "files"
  | "vision"
  | "voice"
  | "act"
  | "memory"
  | "security"
  | "verify";

export type CapabilityDecision = {
  primary: NovaCapability;
  supporting: NovaCapability[];
  requiresPermission: boolean;
  requiresExternalTool: boolean;
  confidence: number;
  rationale: string[];
};

type Signal = { capability: NovaCapability; weight: number; reason: string };

const rules: Array<{ pattern: RegExp; signals: Signal[] }> = [
  { pattern: /\b(what(?:\s+is|\x27s)?\s+(?:today(?:\x27s)?\s+)?(?:date|day|time)|today(?:\x27s)?\s+date|current\s+(?:date|time)|what\s+day\s+is\s+it|what\s+time\s+is\s+it|time\s+now|date\s+today)\b/i,\n    signals: [{ capability: "time", weight: 10, reason: "native date or time requested" }] },\n  { pattern: /\b(latest|current|recent|news|search|research|source|sources|website|online|internet|look up)\b/i,
    signals: [{ capability: "research", weight: 6, reason: "current or external information requested" }] },
  { pattern: /\b(file|pdf|document|xlsx|csv|spreadsheet|attachment|upload|folder|read this)\b/i,
    signals: [{ capability: "files", weight: 6, reason: "file or document capability requested" }] },
  { pattern: /\b(image|photo|picture|screenshot|visual|vision|look at)\b/i,
    signals: [{ capability: "vision", weight: 6, reason: "visual input or output requested" }] },
  { pattern: /\b(code|coding|debug|program|repo|repository|github|typescript|javascript|python|react|next\.js|api|app|website)\b/i,
    signals: [{ capability: "build", weight: 7, reason: "software implementation requested" }] },
  { pattern: /\b(analy[sz]e|analysis|calculate|data|dataset|metrics|statistics|trend|forecast|chart|graph)\b/i,
    signals: [{ capability: "analyze", weight: 6, reason: "structured analysis requested" }] },
  { pattern: /\b(create|generate|write|draft|design|presentation|document|poster|logo|content)\b/i,
    signals: [{ capability: "create", weight: 5, reason: "artifact or content creation requested" }] },
  { pattern: /\b(send|book|buy|deploy|publish|upload|submit|apply|email|message|post|schedule|delete|change|turn on|turn off)\b/i,
    signals: [{ capability: "act", weight: 8, reason: "external side effect requested" }] },
  { pattern: /\b(remember|memory|preference|previously|last time|my usual)\b/i,
    signals: [{ capability: "memory", weight: 5, reason: "persistent or prior context requested" }] },
  { pattern: /\b(security|secure|phishing|scam|malware|vulnerability|secret|credential|prompt injection|hack)\b/i,
    signals: [{ capability: "security", weight: 7, reason: "security analysis requested" }] },
];

const intentDefaults: Record<NovaIntent, NovaCapability> = {
  general: "reason",
  research: "research",
  create: "create",
  analyze: "analyze",
  build: "build",
  plan: "reason",
  act: "act",
};

export function selectNovaCapabilities(text: string, intent: NovaIntent): CapabilityDecision {
  const scores = new Map<NovaCapability, { score: number; reasons: string[] }>();

  for (const rule of rules) {
    if (!rule.pattern.test(text)) continue;
    for (const signal of rule.signals) {
      const current = scores.get(signal.capability) || { score: 0, reasons: [] };
      current.score += signal.weight;
      current.reasons.push(signal.reason);
      scores.set(signal.capability, current);
    }
  }

  const primary = [...scores.entries()].sort((a, b) => b[1].score - a[1].score)[0]?.[0] || intentDefaults[intent];
  const supporting = [...scores.entries()]
    .filter(([capability]) => capability !== primary)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 3)
    .map(([capability]) => capability);

  const requiresPermission = primary === "act" || supporting.includes("act");
  const requiresExternalTool = ["research", "files", "vision", "voice", "act"].includes(primary) ||
    supporting.some((capability) => ["research", "files", "vision", "voice", "act"].includes(capability));

  const topScore = scores.get(primary)?.score || 1;
  const confidence = Math.min(0.98, Math.max(0.55, 0.55 + topScore / 30));

  return {
    primary,
    supporting,
    requiresPermission,
    requiresExternalTool,
    confidence,
    rationale: scores.get(primary)?.reasons || ["intent default"],
  };
}

export function buildCapabilityInstruction(decision: CapabilityDecision) {
  return [
    "NOVA Capability Engine:",
    "Primary capability: " + decision.primary,
    "Supporting capabilities: " + (decision.supporting.join(", ") || "none"),
    "Capability confidence: " + decision.confidence.toFixed(2),
    "External tool required: " + String(decision.requiresExternalTool),
    "Permission required before side effect: " + String(decision.requiresPermission),
    "Selection rationale: " + decision.rationale.join("; "),
    "Use only capabilities actually connected to this runtime.",
    "If a capability is unavailable, do not simulate its result.",
  ].join("\n");
}
