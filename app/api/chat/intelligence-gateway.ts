import type { NovaGatewayPlan } from "./nova-gateway";
import {
  providerLabel,
  requestNovaProvider,
  type NovaProviderAttempt,
} from "./provider-router";

export type NovaIntelligenceAttempt = {
  source: "omniroute" | "provider";
  label: string;
  model: string;
  response: Response;
};

function env(name: string) {
  return process.env[name]?.trim();
}

function gatewayBaseUrl() {
  const raw = env("NOVA_GATEWAY_URL");
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function gatewayModel(plan: NovaGatewayPlan) {
  const specific = env("NOVA_GATEWAY_MODEL_" + plan.intent.toUpperCase());
  if (specific) return specific;

  const common = env("NOVA_GATEWAY_MODEL");
  if (common) return common;

  switch (plan.intent) {
    case "build":
      return "auto/coding";
    case "research":
    case "analyze":
    case "plan":
      return "auto/smart";
    case "general":
    case "create":
    case "act":
    default:
      return "auto";
  }
}

function gatewayHeaders(apiKey: string | undefined) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };

  if (apiKey) headers.Authorization = "Bearer " + apiKey;

  return headers;
}

function shouldFailover(status: number) {
  return (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

async function requestOmniRoute(
  plan: NovaGatewayPlan,
  requestBody: Record<string, unknown>
): Promise<NovaIntelligenceAttempt | null> {
  const baseUrl = gatewayBaseUrl();
  if (!baseUrl) return null;

  const model = gatewayModel(plan);
  const apiKey = env("NOVA_GATEWAY_API_KEY");

  try {
    const { plugins: _plugins, ...omniBody } = requestBody;\n\n    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: gatewayHeaders(apiKey),
      body: JSON.stringify({
        ...requestBody,
        model,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(
        Number(env("NOVA_GATEWAY_TIMEOUT_MS") || 25000)
      ),
    });

    if (response.ok && response.body) {
      return {
        source: "omniroute",
        label: "OmniRoute",
        model,
        response,
      };
    }

    if (shouldFailover(response.status)) {
      await response.body?.cancel().catch(() => {});
      return null;
    }

    return {
      source: "omniroute",
      label: "OmniRoute",
      model,
      response,
    };
  } catch {
    return null;
  }
}

export async function requestNovaIntelligence(
  plan: NovaGatewayPlan,
  requestBody: Record<string, unknown>
): Promise<NovaIntelligenceAttempt | null> {
  const omni = await requestOmniRoute(plan, requestBody);
  if (omni) return omni;

  const directBody = { ...requestBody };

  const direct: NovaProviderAttempt | null = await requestNovaProvider(
    plan,
    directBody
  );

  if (!direct) return null;

  return {
    source: "provider",
    label: providerLabel(direct.provider),
    model: direct.model,
    response: direct.response,
  };
}
