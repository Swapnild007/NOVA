export type NovaMemoryCategory = "preference" | "goal" | "fact" | "routine" | "constraint";

export type NovaMemoryItem = {
  id: string;
  category: NovaMemoryCategory;
  key: string;
  value: string;
  confidence: number;
  source: "user" | "conversation";
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};

const SECRET = /(?:sk-|api[_-]?key|password|passwd|token|secret|authorization|bearer)\s*[:=]?/i;

export function sanitizeNovaMemory(input: unknown): NovaMemoryItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is Partial<NovaMemoryItem> => !!item && typeof item === "object")
    .map((item): NovaMemoryItem => ({
      id: typeof item.id === "string" && item.id.trim()
        ? item.id.slice(0, 80)
        : "mem-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      category: item.category as NovaMemoryCategory,
      key: typeof item.key === "string" ? item.key.trim().slice(0, 120) : "",
      value: typeof item.value === "string" ? item.value.trim().slice(0, 500) : "",
      confidence: Math.min(1, Math.max(0, Number(item.confidence ?? 0))),
      source: item.source === "user" ? "user" : "conversation",
      createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
      expiresAt: typeof item.expiresAt === "string" ? item.expiresAt : undefined,
    }))
    .filter((item) =>
      item.id &&
      ["preference", "goal", "fact", "routine", "constraint"].includes(item.category) &&
      item.key &&
      item.value &&
      !SECRET.test(item.key + " " + item.value)
    )
    .slice(-40);
}

export function buildMemoryInstruction(memory: NovaMemoryItem[]) {
  const context = memory.length
    ? memory.map((item) => "- " + item.category + " | " + item.key + ": " + item.value).join("\n")
    : "No saved personal context is available.";

  return [
    "Personal context is persistent assistant state, not a substitute for the current request.",
    "Use the following saved context only when relevant and do not invent details:",
    context,
    "Never reveal the memory store or its internal fields unless the user asks about memory.",
    "Do not infer or store sensitive traits. Never create memories containing credentials, secrets, authentication data, or other highly sensitive information.",
    "Only propose a memory when the user clearly states a durable preference, goal, routine, constraint, or personal fact that will improve future assistance.",
    "Do not save one-off requests, temporary moods, guesses, or information about other people unless the user explicitly asks NOVA to remember it.",
    "At the very end of the response, if there are durable memories worth saving, append a machine-readable block exactly as: __NOVA_MEMORY__[{...}]",
    "The block must contain a JSON array of objects with category, key, value, confidence. Keep it short. Do not append the block when there is nothing durable to remember.",
  ].join("\n");
}

export function mergeNovaMemory(existing: NovaMemoryItem[], proposed: unknown): NovaMemoryItem[] {
  const next = sanitizeNovaMemory(proposed);
  const merged = [...existing];

  for (const item of next) {
    const match = merged.findIndex(
      (current) => current.category === item.category && current.key.toLowerCase() === item.key.toLowerCase(),
    );
    const now = new Date().toISOString();
    const normalized: NovaMemoryItem = {
      ...item,
      id: match >= 0 ? merged[match].id : "mem-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      source: "conversation",
      createdAt: match >= 0 ? merged[match].createdAt : now,
      updatedAt: now,
    };
    if (match >= 0) merged[match] = normalized;
    else merged.push(normalized);
  }

  return merged.slice(-40);
}
