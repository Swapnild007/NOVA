import {
  buildNovaSystem,
  createNovaPlan,
  prepareNovaMessages,
} from "./nova-gateway";
import {
  providerLabel,
  requestNovaProvider,
} from "./provider-router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type UsagePayload = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

const USAGE_MARKER = "__NOVA_USAGE__";
const MAX_MESSAGES = 40;

function env(name: string) {
  return process.env[name]?.trim();
}

function safeUpstreamDetail(raw: string) {
  const cleaned = raw.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]");
  try {
    const parsed = JSON.parse(cleaned);
    const message =
      parsed?.error?.message ||
      parsed?.message ||
      parsed?.error ||
      cleaned;
    return String(message).slice(0, 500);
  } catch {
    return cleaned.replace(/\s+/g, " ").slice(0, 500);
  }
}

function upstreamFailure(status: number, detail: string, service: string) {
  const known =
    status === 401
      ? "OpenRouter rejected the API key (401 Unauthorized)."
      : status === 402
        ? "OpenRouter rejected the request because the account/key has insufficient credits or budget (402)."
        : status === 403
          ? "OpenRouter rejected the request (403 Forbidden)."
          : status === 429
            ? "OpenRouter rate-limited the request (429)."
            : status >= 500
              ? "OpenRouter or the selected provider returned a server error."
              : "OpenRouter rejected the request.";
  const extra = safeUpstreamDetail(detail);
  return `NOVA ${service} connection failed: ${known}${extra ? " Detail: " + extra : ""}`;
}

function sanitizeMessages(rawMessages: unknown): IncomingMessage[] {
  if (!Array.isArray(rawMessages)) return [];

  return rawMessages
    .filter(
      (message): message is IncomingMessage =>
        !!message &&
        typeof message === "object" &&
        typeof (message as IncomingMessage).content === "string" &&
        ["user", "assistant", "system"].includes(
          (message as IncomingMessage).role
        )
    )
    .slice(-MAX_MESSAGES);
}

export async function POST(request: Request) {

  try {
    const body = (await request.json()) as { messages?: unknown };
    const validMessages = sanitizeMessages(body.messages);

    if (!validMessages.length) {
      return new Response("NOVA needs a message to begin.", { status: 400 });
    }

    const plan = createNovaPlan(validMessages);
    const messages = prepareNovaMessages(
      validMessages,
      plan.contextMessages
    );

    if (!messages.length) {
      return new Response("NOVA needs a message to begin.", { status: 400 });
    }

    const requestBody: Record<string, unknown> = {
      messages: [
        { role: "system", content: buildNovaSystem(plan) },
        ...messages,
      ],
      stream: true,
    };

    if (plan.useWeb) {
      requestBody.plugins = [
        {
          id: "web",
          max_results: plan.deepResearch ? 8 : 5,
          ...(plan.deepResearch
            ? {
                search_prompt:
                  "Use multiple relevant sources, cross-check important claims, and cite useful sources in the final answer.",
              }
            : {}),
        },
      ];
    }

    const attempt = await requestNovaProvider(plan, requestBody);

    if (!attempt) {
      return new Response(
        "NOVA could not reach any configured intelligence provider. Add GEMINI_API_KEY or GROQ_API_KEY to create a fallback path, or keep OPENROUTER_API_KEY configured.",
        { status: 200 }
      );
    }

    const { response: upstream } = attempt;

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error("NOVA provider error", {
        provider: attempt.provider,
        model: attempt.model,
        status: upstream.status,
        intent: plan.intent,
        web: plan.useWeb,
        detail,
      });
      return new Response(
        upstreamFailure(upstream.status, detail, "intelligence"),
        { status: 200 }
      );
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = "";
        let usage: UsagePayload | null = null;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || "";

            for (const event of events) {
              const parsed = emitSseText(event, controller, encoder);
              if (parsed) usage = parsed;
            }
          }

          buffer += decoder.decode();
          if (buffer) {
            const parsed = emitSseText(buffer, controller, encoder);
            if (parsed) usage = parsed;
          }

          if (usage) {
            controller.enqueue(
              encoder.encode(
                USAGE_MARKER + JSON.stringify(usage)
              )
            );
          }

          controller.close();
        } catch (error) {
          console.error("NOVA stream error", error);
          controller.error(error);
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-NOVA-Intent": plan.intent,
        "X-NOVA-Provider": providerLabel(attempt.provider),
        "X-NOVA-Web": String(plan.useWeb && attempt.provider === "openrouter"),
      },
    });
  } catch (error) {
    console.error("NOVA gateway error", error);
    const detail = error instanceof Error ? error.message : String(error);
    return new Response(
      "NOVA's intelligence gateway failed before contacting OpenRouter. Detail: " +
        safeUpstreamDetail(detail),
      { status: 200 }
    );
  }
}

function emitSseText(
  event: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): UsagePayload | null {
  const lines = event.split(/\r?\n/);
  let usage: UsagePayload | null = null;

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;

    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    try {
      const json = JSON.parse(data);
      const delta = json?.choices?.[0]?.delta?.content;

      if (typeof delta === "string" && delta) {
        controller.enqueue(encoder.encode(delta));
      }

      if (json?.usage && typeof json.usage === "object") {
        usage = {
          prompt_tokens: Number(json.usage.prompt_tokens || 0),
          completion_tokens: Number(json.usage.completion_tokens || 0),
          total_tokens: Number(json.usage.total_tokens || 0),
          cost:
            typeof json.usage.cost === "number"
              ? json.usage.cost
              : undefined,
        };
      }
    } catch {
      // Ignore non-JSON SSE keepalive/progress frames.
    }
  }

  return usage;
}
