export type NovaCapabilityProfile = {
  reasoning: number;
  coding: number;
  research: number;
  longContext: number;
  structuredOutput: number;
  speed: number;
  reliability: number;
};

export type NovaCapabilityIntent = "general" | "research" | "create" | "analyze" | "build" | "plan" | "act";

const profiles: Record<"gemini" | "groq" | "mistral", NovaCapabilityProfile> = {
  gemini: {
    reasoning: 9,
    coding: 9,
    research: 9,
    longContext: 9,
    structuredOutput: 9,
    speed: 9,
    reliability: 8,
  },
  groq: {
    reasoning: 8,
    coding: 9,
    research: 7,
    longContext: 8,
    structuredOutput: 8,
    speed: 10,
    reliability: 8,
  },
  mistral: {
    reasoning: 8,
    coding: 8,
    research: 8,
    longContext: 8,
    structuredOutput: 9,
    speed: 8,
    reliability: 8,
  },
};

const weights: Record<NovaCapabilityIntent, Partial<Record<keyof NovaCapabilityProfile, number>>> = {
  general: { reasoning: 0.25, reliability: 0.2, speed: 0.2, longContext: 0.1, structuredOutput: 0.1, coding: 0.075, research: 0.075 },
  research: { research: 0.3, reasoning: 0.2, longContext: 0.2, reliability: 0.15, structuredOutput: 0.1, speed: 0.05 },
  create: { reasoning: 0.2, structuredOutput: 0.25, speed: 0.15, reliability: 0.2, longContext: 0.1, coding: 0.05, research: 0.05 },
  analyze: { reasoning: 0.3, structuredOutput: 0.2, longContext: 0.15, reliability: 0.2, coding: 0.05, research: 0.1 },
  build: { coding: 0.3, reasoning: 0.25, structuredOutput: 0.15, reliability: 0.15, speed: 0.1, longContext: 0.05 },
  plan: { reasoning: 0.3, reliability: 0.2, longContext: 0.15, structuredOutput: 0.15, speed: 0.1, coding: 0.05, research: 0.05 },
  act: { reliability: 0.3, structuredOutput: 0.2, reasoning: 0.2, speed: 0.15, coding: 0.05, longContext: 0.05, research: 0.05 },
};

export function getNovaCapabilityScore(id: keyof typeof profiles, intent: NovaCapabilityIntent) {
  const profile = profiles[id];
  return Object.entries(weights[intent]).reduce(
    (score, [key, weight]) => score + profile[key as keyof NovaCapabilityProfile] * (weight || 0),
    0,
  );
}

export function getNovaCapabilityProfile(id: keyof typeof profiles) {
  return profiles[id];
}
