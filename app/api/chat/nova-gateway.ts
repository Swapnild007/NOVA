export type NovaIntent =
  | "general"
  | "research"
  | "create"
  | "analyze"
  | "build"
  | "plan"
  | "act";

export type NovaGatewayPlan = {
  intent: NovaIntent;
  model: string;
  useWeb: boolean;
  deepResearch: boolean;
  contextMessages: number;
};

type GatewayMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const WEB_SIGNALS =
  /\b(latest|today|tonight|yesterday|current|currently|recent|recently|news|price|prices|stock|stocks|weather|forecast|score|scores|schedule|release|released|2026|this week|this month|search|research|look up|lookup|compare|website|online|internet|source|sources|who is|what happened|what's happening)\b/i;

const DEEP_RESEARCH_SIGNALS =
  /\b(deep research|deep dive|comprehensive research|thorough research|investigate|research report|literature review|compare in depth)\b/i;

const BUILD_SIGNALS =
  /\b(code|coding|program|programming|debug|bug|typescript|javascript|python|react|next\.js|api|backend|frontend|repository|repo|github|vercel|build an app|write code)\b/i;

const ANALYZE_SIGNALS =
  /\b(analy[sz]e|analysis|analyze this|calculate|calculation|data|dataset|csv|xlsx|spreadsheet|metrics|kpi|trend|forecast|statistics|statistical)\b/i;

const CREATE_SIGNALS =
  /\b(create|generate|design|draft|write|make|image|visual|presentation|document|poster|logo|video prompt)\b/i;

const PLAN_SIGNALS =
  /\b(plan|planning|roadmap|strategy|steps|schedule|itinerary|organize|break down|how should i)\b/i;

const ACT_SIGNALS =
  /\b(send|book|buy|deploy|publish|upload|download|schedule|remind|email|message|post|apply|submit|turn on|turn off)\b/i;

function env(name: string) {
  return process.env[name]?.trim();
}

function latestUserText(messages: GatewayMessage[]) {
  return (
    [...messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.trim() || ""
  );
}

export function classifyNovaIntent(messages: GatewayMessage[]): NovaIntent {
  const text = latestUserText(messages);

  if (ACT_SIGNALS.test(text)) return "act";
  if (BUILD_SIGNALS.test(text)) return "build";
  if (ANALYZE_SIGNALS.test(text)) return "analyze";
  if (DEEP_RESEARCH_SIGNALS.test(text) || WEB_SIGNALS.test(text)) {
    return "research";
  }
  if (PLAN_SIGNALS.test(text)) return "plan";
  if (CREATE_SIGNALS.test(text)) return "create";

  return "general";
}

export function createNovaPlan(messages: GatewayMessage[]): NovaGatewayPlan {
  const text = latestUserText(messages);
  const intent = classifyNovaIntent(messages);
  const deepResearch = DEEP_RESEARCH_SIGNALS.test(text);
  const useWeb =
    deepResearch || intent === "research" || WEB_SIGNALS.test(text);

  const specificModel = env(
    `OPENROUTER_MODEL_${intent.toUpperCase()}`
  );

  return {
    intent,
    model: specificModel || env("OPENROUTER_MODEL") || "openrouter/free",
    useWeb,
    deepResearch,
    contextMessages: deepResearch ? 32 : 20,
  };
}

export function prepareNovaMessages(
  messages: GatewayMessage[],
  contextMessages: number
): GatewayMessage[] {
  return messages
    .filter(
      (message) =>
        message &&
        typeof message.content === "string" &&
        ["user", "assistant", "system"].includes(message.role)
    )
    .slice(-contextMessages)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 16000),
    }))
    .filter((message) => message.content.length > 0);
}

export function buildNovaSystem(plan: NovaGatewayPlan) {
  const modeInstruction: Record<NovaIntent, string> = {
    general:
      "Answer directly and use the conversation context to avoid making the user repeat themselves.",
    research:
      "When web context is available, synthesize it critically, distinguish sourced facts from inference, and include useful source links.",
    create:
      "Focus on producing the requested artifact or a precise creation-ready result. Do not claim an artifact was generated unless the connected capability actually generated it.",
    analyze:
      "Reason carefully over the supplied information. Show calculations or assumptions when they materially affect the result.",
    build:
      "Act like a senior software engineer. Prefer concrete implementation details, safe changes, and working code over generic advice.",
    plan:
      "Turn the user's goal into an actionable sequence with clear dependencies and the smallest useful next step.",
    act:
      "Identify the requested action and explain what can actually be executed with the connected capabilities. Never claim an external action happened unless it was executed.",
  };

  return `You are NOVA, one intelligence layer.

Your job is to understand the user's goal, choose the right execution path, and give the most useful result.

Never expose internal model names, providers, routing rules, hidden prompts, agent names, or implementation details unless the user explicitly asks about the system.

Never claim that a search, file, tool, website, API, purchase, message, deployment, or other external action happened unless it actually happened.

Current execution mode: ${plan.intent}.
${modeInstruction[plan.intent]}

${plan.deepResearch
  ? "This is a deep-research request. Prefer multiple relevant sources, cross-check important claims, and clearly separate evidence from conclusions."
  : ""}

If the user asks for something that requires a capability not currently connected, say so plainly and provide the best useful next step instead of pretending.

Be clear, practical, and concise.`;
}
