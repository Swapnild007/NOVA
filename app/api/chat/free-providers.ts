import type { NovaGatewayPlan } from "./nova-gateway";

type ProviderId = "gemini" | "mistral" | "groq" | "nvidia" | "cerebras" | "zai" | "qwen" | "freellmapi" | "gateway";

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
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    keyEnv: "NVIDIA_API_KEY",
    modelEnv: "NVIDIA_MODEL",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    defaultModel: "openai/gpt-oss-20b",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    keyEnv: "CEREBRAS_API_KEY",
    modelEnv: "CEREBRAS_MODEL",
    defaultBaseUrl: "https://api.cerebras.ai/v1",
  },
  {
    id: "zai",
    label: "Z.AI",
    keyEnv: "ZAI_API_KEY",
    modelEnv: "ZAI_MODEL",
    baseEnv: "ZAI_BASE_URL",
    defaultBaseUrl: "https://api.z.ai/api/paas/v4",
  },
  {
    id: "freellmapi",
    label: "FreeLLMAPI",
    keyEnv: "FREELLMAPI_API_KEY",
    modelEnv: "FREELLMAPI_MODEL",
    baseEnv: "FREELLMAPI_BASE_URL",
    defaultBaseUrl: "http://localhost:3001/v1",
  },
  {
    id: "qwen",
    label: "Alibaba Qwen",
    keyEnv: "DASHSCOPE_API_KEY",
    modelEnv: "DASHSCOPE_MODEL",
    baseEnv: "DASHSCOPE_BASE_URL",
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  },
];

function orderForPlan(plan: NovaGatewayPlan) {
  const configured = env("NOVA_PROVIDER_ORDER");
  if (configured) {
    return configured.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) as ProviderId[];
  }

  const defaults: Record<NovaGatewayPlan["intent"], ProviderId[]> = {
    general: ["gemini", "groq", "cerebras", "mistral", "freellmapi", "nvidia", "zai", "qwen", "gateway"],
    research: ["gemini", "cerebras", "mistral", "qwen", "freellmapi", "groq", "nvidia", "zai", "gateway"],
    create: ["gemini", "mistral", "groq", "cerebras", "nvidia", "zai", "qwen", "freellmapi", "gateway"],
    analyze: ["gemini", "mistral", "cerebras", "groq", "nvidia", "zai", "qwen", "freellmapi", "gateway"],
    build: ["gemini", "groq", "cerebras", "mistral", "nvidia", "qwen", "zai", "freellmapi", "gateway"],
    plan: ["gemini", "mistral", "cerebras", "groq", "nvidia", "zai", "qwen", "freellmapi", "gateway"],
    act: ["gemini", "groq", "cerebras", "mistral", "nvidia", "zai", "qwen", "freellmapi", "gateway"],
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
  for (const id of orderForPlan(plan)) {
    if (id === "gateway") {
      const gateway = await callGateway(plan, body);
      if (gateway?.response.ok) return gateway;
      if (gateway && gateway.response.status !== 429 && gateway.response.status < 500) return gateway;
      continue;
    }

    const provider = providerConfig(id);
    if (!provider || !hasDirectProvider(provider)) continue;

    const attempt = await callDirectProvider(provider, body);
    if (!attempt) continue;

    if (attempt.response.ok) return attempt;

    // Free tiers are expected to hit 401/402/403/404/429 as quotas or model
    // access change. Continue to the next independent provider instead of
    // taking NOVA offline.
    if (attempt.response.status === 401 || attempt.response.status === 402 ||
        attempt.response.status === 403 || attempt.response.status === 404 ||
        attempt.response.status === 429 || attempt.response.status >= 500) {
      continue;
    }

    return attempt;
  }

  return null;
}

export function getConfiguredNovaProviders() {
  const ids = env("NOVA_PROVIDER_ORDER")
    ? env("NOVA_PROVIDER_ORDER")!.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean) as ProviderId[]
    : ["gemini", "mistral", "groq", "cerebras", "nvidia", "zai", "qwen", "freellmapi", "gateway"] as ProviderId[];

  return ids
    .map((id) => id === "gateway" ? "NOVA Gateway" : providerConfig(id))
    .filter((provider): provider is ProviderConfig | "NOVA Gateway" =>
      provider === "NOVA Gateway" || Boolean(provider && hasDirectProvider(provider))
    )
    .map((provider) => typeof provider === "string" ? provider : provider.label);
}
