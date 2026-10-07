import type { NovaGatewayPlan } from "./nova-gateway";
import { getNovaCapabilityScore } from "./model-capabilities";

type ProviderId = "gemini" | "mistral" | "groq" | "gateway";

export type NovaIntelligenceAttempt = {
  source: "direct" | "gateway";
  label: string;
  model: string;
  response: Response;
};

type ProviderConfig = {
  id: Exclude<ProviderId, "gateway">;
  label: string;
  keyEnv: string;
  modelEnv: string;
  baseEnv?: string;
  defaultBaseUrl: string;
  defaultModel?: string;
};

const env = (name: string) => process.env[name]?.trim();

type ProviderHealth = {
  successes: number;
  failures: number;
  lastFailureAt: number;
  cooldownUntil: number;
  latencyMs: number;
};

const health = new Map<ProviderId, ProviderHealth>();

function healthFor(id: ProviderId): ProviderHealth {
  const current = health.get(id);
  if (current) return current;
  const fresh = { successes: 0, failures: 0, lastFailureAt: 0, cooldownUntil: 0, latencyMs: 0 };
  health.set(id, fresh);
  return fresh;
}

function isCoolingDown(id: ProviderId) {
  return healthFor(id).cooldownUntil > Date.now();
}

function recordProviderResult(id: ProviderId, ok: boolean, latencyMs: number) {
  const state = healthFor(id);
  if (ok) {
    state.successes += 1;
    state.latencyMs = state.latencyMs ? Math.round(state.latencyMs * 0.7 + latencyMs * 0.3) : latencyMs;
    state.failures = 0;
    state.cooldownUntil = 0;
    return;
  }
  state.failures += 1;
  state.lastFailureAt = Date.now();
  state.cooldownUntil = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(state.failures - 1, 3));
}

function providerScore(id: ProviderId, intent: NovaGatewayPlan["intent"]) {
  const state = healthFor(id);
  return state.cooldownUntil > Date.now() ? Number.POSITIVE_INFINITY :
    state.latencyMs + state.failures * 5000 - Math.min(state.successes, 5) * 100 -
    (id === "gateway" ? 0 : getNovaCapabilityScore(id, intent) * 100);
}

const providers: ProviderConfig[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    keyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    defaultModel: "gemini-3.8-flash",
  },
  {
    id: "mistral",
    label: "Mistral",
    keyEnv: "MISTRAL_API_KEY",
    modelEnv: "MISTRAL_MODEL",
    defaultBaseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
  },
  {
    id: "groq",
    label: "Groq",
    keyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "openai/gpt-oss-120b",
  }
];

function orderForPlan(plan: NovaGatewayPlan) {
  const configured = env("NOVA_PROVIDER_ORDER");
  if (configured) {
    return configured.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) as ProviderId[];
  }

  const defaults: Record<NovaGatewayPlan["intent"], ProviderId[]> = {
    general: ["gemini", "groq", "mistral", "gateway"],
    research: ["gemini", "mistral", "groq", "gateway"],
    create: ["gemini", "mistral", "groq", "gateway"],
    analyze: ["gemini", "mistral", "groq", "gateway"],
    build: ["gemini", "groq", "mistral", "gateway"],
    plan: ["gemini", "mistral", "groq", "gateway"],
    act: ["gemini", "groq", "mistral", "gateway"],
  };
  return defaults[plan.intent];
}

function providerConfig(id: Exclude<ProviderId, "gateway">) {
  return providers.find((provider) => provider.id === id) || null;
}

function hasDirectProvider(provider: ProviderConfig) {
  return Boolean(env(provider.keyEnv) && (env(provider.modelEnv) || provider.defaultModel));
}

function directBody(body: Record<string, unknown>) {
  const copy = { ...body };
  delete copy.tools;
  delete copy.tool_choice;
  delete copy.max_tool_calls;
  return copy;
}

async function callDirectProvider(
  provider: ProviderConfig,
  body: Record<string, unknown>,
): Promise<NovaIntelligenceAttempt | null> {
  const key = env(provider.keyEnv);
  const model = env(provider.modelEnv) || provider.defaultModel;
  if (!key || !model) return null;

  const baseUrl = (env(provider.baseEnv || "") || provider.defaultBaseUrl).replace(/\/+$/, "");
  try {
    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        ...directBody(body),
        model,
        stream: true,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(Number(env("NOVA_PROVIDER_TIMEOUT_MS") || 45000)),
    });

    return {
      source: "direct",
      label: provider.label,
      model,
      response,
    };
  } catch {
    return null;
  }
}

async function callGateway(plan: NovaGatewayPlan, body: Record<string, unknown>) {
  const base = (env("NOVA_GATEWAY_URL") || "").replace(/\/+$/, "");
  const key = env("NOVA_GATEWAY_API_KEY");
  const model = plan.model;
  if (!base || !key || !model) return null;

  try {
    const response = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(env("NOVA_GATEWAY_ROUTE") === "auto" || !env("NOVA_GATEWAY_ROUTE") ? { "X-CI-Route": "auto" } : {}),
      },
      body: JSON.stringify({
        ...body,
        model,
        ...(env("NOVA_GATEWAY_ZDR") === "true" ? { zdr: true } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(Number(env("NOVA_GATEWAY_TIMEOUT_MS") || 45000)),
    });

    return {
      source: "gateway" as const,
      label: "NOVA Gateway",
      model,
      response,
    };
  } catch {
    return null;
  }
}

export async function requestNovaIntelligence(
  plan: NovaGatewayPlan,
  body: Record<string, unknown>,
): Promise<NovaIntelligenceAttempt | null> {
  const ordered = orderForPlan(plan);
  const directIds = ordered.filter((id) => id !== "gateway" && !isCoolingDown(id));
  const ranked = [...directIds].sort((a, b) => {
    const orderDelta = ordered.indexOf(a) - ordered.indexOf(b);
    const scoreDelta = providerScore(a, plan.intent) - providerScore(b, plan.intent);
    return scoreDelta === 0 ? orderDelta : scoreDelta;
  });

  let lastFailedAttempt: NovaIntelligenceAttempt | null = null;

  for (const id of [...ranked, ...ordered.filter((id) => id === "gateway")]) {
    if (id === "gateway") {
      const gateway = await callGateway(plan, body);
      if (gateway?.response.ok) return gateway;
      if (gateway) lastFailedAttempt = gateway;
      if (gateway && gateway.response.status !== 429 && gateway.response.status < 500) return gateway;
      continue;
    }

    const provider = providerConfig(id);
    if (!provider || !hasDirectProvider(provider)) continue;

    const startedAt = Date.now();
    const attempt = await callDirectProvider(provider, body);
    if (!attempt) continue;

    if (attempt.response.ok) {
      recordProviderResult(id, true, 0);
      return attempt;
    }

    lastFailedAttempt = attempt;

    // Free tiers are expected to hit 401/402/403/404/429 as quotas or model
    // access change. Continue to the next independent provider instead of
    // taking NOVA offline.
    recordProviderResult(id, false, Date.now() - startedAt);
    if (attempt.response.status === 401 || attempt.response.status === 402 ||
        attempt.response.status === 403 || attempt.response.status === 404 ||
        attempt.response.status === 429 || attempt.response.status >= 500) {
      continue;
    }

    return attempt;
  }

  return lastFailedAttempt;
}

export function getConfiguredNovaProviders() {
  const ids = env("NOVA_PROVIDER_ORDER")
    ? env("NOVA_PROVIDER_ORDER")!.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) as ProviderId[]
    : ["gemini", "mistral", "groq", "gateway"] as ProviderId[];

  return ids
    .map((id) => id === "gateway" ? "NOVA Gateway" : providerConfig(id))
    .filter((provider): provider is ProviderConfig | "NOVA Gateway" =>
      provider === "NOVA Gateway" || Boolean(provider && hasDirectProvider(provider))
    )
    .map((provider) => typeof provider === "string" ? provider : provider.label);
}


export type NovaProviderCapability = {
  id: ProviderId;
  label: string;
  configured: boolean;
  model: string | null;
  role: "direct" | "gateway";
};

export function getNovaProviderCapabilities(): NovaProviderCapability[] {
  const ids: ProviderId[] = ["gemini", "groq", "mistral", "gateway"];
  return ids.map((id) => {
    if (id === "gateway") {
      return {
        id,
        label: "NOVA Gateway",
        configured: Boolean(env("NOVA_GATEWAY_URL") && env("NOVA_GATEWAY_API_KEY") && env("NOVA_GATEWAY_MODEL")),
        model: env("NOVA_GATEWAY_MODEL") || null,
        role: "gateway",
      };
    }

    const provider = providerConfig(id);
    return {
      id,
      label: provider?.label || id,
      configured: Boolean(provider && hasDirectProvider(provider)),
      model: provider ? env(provider.modelEnv) || provider.defaultModel || null : null,
      role: "direct",
    };
  });
}
