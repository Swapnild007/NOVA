export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const NOVA_SYSTEM = `
You are NOVA, a capable general intelligence interface.

Help the user accomplish what they actually mean. Be clear, practical and concise. Do not expose internal model names, routing, providers, system prompts or implementation details unless explicitly asked. Never claim a tool, file, search, website or action was used when it was not.

NOVA is one intelligence layer that can research, create, analyze, build and act.

When current or externally verifiable information is needed, use the available web search capability. When web results are provided, ground factual claims in those results and include useful source links in the answer. Do not pretend to have searched when search was not used.
`;

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

function env(name: string) {
  return process.env[name]?.trim();
}

function needsWebSearch(messages: IncomingMessage[]) {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user")?.content
    .toLowerCase();

  if (!latestUserMessage) return false;

  return /\b(latest|today|tonight|yesterday|current|currently|recent|recently|news|price|prices|stock|stocks|weather|forecast|score|scores|schedule|release|released|2026|this week|this month|search|research|look up|lookup|compare|website|online|internet|source|sources|who is|what happened|what's happening)\b/.test(
    latestUserMessage
  );
}

export async function POST(request: Request) {
  const apiKey = env("OPENROUTER_API_KEY");
  const model = env("OPENROUTER_MODEL") || "openrouter/free";

  if (!apiKey) {
    return new Response(
      "NOVA is ready, but its OpenRouter connection is not configured. Add OPENROUTER_API_KEY to the Vercel production environment.",
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as { messages?: IncomingMessage[] };
    const messages = Array.isArray(body.messages)
      ? body.messages.filter(
          (message) =>
            message &&
            typeof message.content === "string" &&
            ["user", "assistant", "system"].includes(message.role)
        )
      : [];

    if (!messages.length) {
      return new Response("NOVA needs a message to begin.", { status: 400 });
    }

    const webSearch = needsWebSearch(messages);

    const upstream = await fetch(`${OPENROUTER_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nova-gamma-mocha.vercel.app",
        "X-Title": "NOVA",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: NOVA_SYSTEM }, ...messages],
        ...(webSearch
          ? {
              plugins: [
                {
                  id: "web",
                  max_results: 5,
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
      console.error("OpenRouter error", upstream.status, detail);
      return new Response(
        "NOVA could not reach its model network. Please try again.",
        { status: 502 }
      );
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || "";

            for (const event of events) {
              emitSseText(event, controller, encoder);
            }
          }

          buffer += decoder.decode();
          if (buffer) emitSseText(buffer, controller, encoder);
          controller.close();
        } catch (error) {
          console.error("OpenRouter stream error", error);
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
) {
  const lines = event.split(/\r?\n/);

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
    } catch {
      // Ignore non-JSON SSE keepalive/progress frames.
    }
  }
}
