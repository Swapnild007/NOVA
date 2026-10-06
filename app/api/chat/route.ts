import {
  buildNovaSystem,
  createNovaPlan,
  prepareNovaMessages,
} from "./nova-gateway";

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

const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const USAGE_MARKER = "__NOVA_USAGE__";

function env(name: string) {
  return process.env[name]?.trim();
}

export async function POST(request: Request) {
  const apiKey = env("OPENROUTER_API_KEY");

  if (!apiKey) {
    return new Response(
      "NOVA is ready, but its OpenRouter connection is not configured. Add OPENROUTER_API_KEY to the Vercel production environment.",
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as { messages?: IncomingMessage[] };
    const rawMessages = Array.isArray(body.messages) ? body.messages : [];
    const validMessages = rawMessages.filter(
      (message) =>
        message &&
        typeof message.content === "string" &&
        ["user", "assistant", "system"].includes(message.role)
    );

    if (!validMessages.length) {
      return new Response("NOVA needs a message to begin.", { status: 400 });
    }

    const plan = createNovaPlan(validMessages);
    const messages = prepareNovaMessages(
      validMessages,
      plan.contextMessages
    );

    const upstream = await fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nova-gamma-mocha.vercel.app",
        "X-Title": "NOVA",
      },
      body: JSON.stringify({
        model: plan.model,
        messages: [
          { role: "system", content: buildNovaSystem(plan) },
          ...messages,
        ],
        ...(plan.useWeb
          ? {
              plugins: [
                {
                  id: "web",
                  max_results: plan.deepResearch ? 8 : 5,
                  search_prompt: plan.deepResearch
                    ? "Use multiple relevant sources, cross-check important claims, and cite useful sources in the final answer."
                    : undefined,
                },
              ],
            }
          : {}),
        stream: true,
      }),
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error("NOVA upstream error", {
        status: upstream.status,
        intent: plan.intent,
        model: plan.model,
        detail,
      });
      return new Response(
        "NOVA could not reach its intelligence service. Please try again.",
        { status: 502 }
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
                `${USAGE_MARKER}${JSON.stringify(usage)}`
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
        "X-NOVA-Web": String(plan.useWeb),
      },
    });
  } catch (error) {
    console.error("NOVA gateway error", error);
    return new Response("NOVA's intelligence gateway is unavailable.", {
      status: 503,
    });
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
