import type { NovaGatewayPlan } from "./nova-gateway";

export type NovaProvider = "openrouter" | "gemini" | "groq";

export type NovaProviderAttempt = {
  provider: NovaProvider;
  model: string;
  response: Response;
};

const PROVIDER_ORDER: NovaProvider[] = ["gemini", "groq", "openrouter"];

function env(name: string) {
  return process.env[name]?.trim();
}

function listEnv(name: string) {
  return (env(name) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function providerOrder(): NovaProvider[] {
  const configured = listEnv("NOVA_PROVIDER_ORDER")
    .map((value) => value.toLowerCase())
    .filter(
      (value): value is NovaProvider =>
        value === "gemini" || value === "groq" || value === "openrouter"
    );

  return [...new Set([...configured, ...PROVIDER_ORDER])];
}

function modelsFor(provider: NovaProvider, plan: NovaGatewayPlan) {
  if (provider === "gemini") {
    return [
      env("GEMINI_MODEL") || "gemini-3.8-flash",
      ...listEnv("GEMINI_FALLBACK_MODELS"),
    ];
  }

  if (provider === "groq") {
    return [
      env("GROQ_MODEL") || "openai/gpt-oss-20b",
      ...listEnv("GROQ_FALLBACK_MODELS"),
    ];
  }

  return [plan.model, ...plan.fallbackModels];
}

function apiKeyFor(provider: NovaProvider) {
  if (provider === "gemini") return env("GEMINI_API_KEY");
  if (provider === "groq") return env("GROQ_API_KEY");
  return env("OPENROUTER_API_KEY");
}

function endpointFor(provider: NovaProvider) {
  if (provider === "gemini") {
    return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  }

  if (provider === "groq") {
    return "https://api.groq.com/openai/v1/chat/completions";
  }

  return "https://openrouter.ai/api/v1/chat/completions";
}

function headersFor(provider: NovaProvider, apiKey: string) {
  const headers: Record<string, string> = {
    Authorization: "Bearer " + apiKey,
    "Content-Type": "application/json",
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://nova-gamma-mocha.vercel.app";
    headers["X-Title"] = "NOVA";
  }

  if (provider === "gemini") {
    headers["x-goog-api-client"] = "NOVA/1.0";
  }

  return headers;
}

function shouldTryAnotherProvider(status: number) {
  return status === 401 || status === 402 || status === 403 || status === 404 ||
    status === 408 || status === 409 || status === 429 || status >= 500;
}

export async function requestNovaProvider(
  plan: NovaGatewayPlan,
  requestBody: Record<string, unknown>
): Promise<NovaProviderAttempt | null> {
  for (const provider of providerOrder()) {
    const apiKey = apiKeyFor(provider);
    if (!apiKey) continue;

    const models = [...new Set(modelsFor(provider, plan).filter(Boolean))];

    for (const model of models) {
      const body = {
        ...requestBody,
        model,
        ...(provider === "openrouter" && requestBody.plugins
          ? { plugins: requestBody.plugins }
          : { plugins: undefined }),
      };

      if (body.plugins === undefined) delete body.plugins;

      try {
        const response = await fetch(endpointFor(provider), {
          method: "POST",
          headers: headersFor(provider, apiKey),
          body: JSON.stringify(body),
          cache: "no-store",
          signal: AbortSignal.timeout(
            Number(env("NOVA_PROVIDER_TIMEOUT_MS") || 20000)
          ),
        });

        if (response.ok && response.body) {
          return { provider, model, response };
        }

        if (!shouldTryAnotherProvider(response.status)) {
          return { provider, model, response };
        }

        await response.body?.cancel().catch(() => {});
      } catch {
        // Try the next model/provider. The final caller surfaces a clean failure.
      }
    }
  }

  return null;
}

export function providerLabel(provider: NovaProvider) {
  if (provider === "gemini") return "Gemini";
  if (provider === "groq") return "Groq";
  return "OpenRouter";
}
