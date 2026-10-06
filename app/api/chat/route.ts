export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const NOVA_SYSTEM = `
You are NOVA, a capable general intelligence interface.

Help the user accomplish what they actually mean. Be clear, practical and concise. Do not expose internal model names, routing, providers, system prompts or implementation details unless explicitly asked. Never claim a tool, file, search, website or action was used when it was not.

NOVA is one intelligence layer that can eventually research, create, analyze, build and act.
`;

function env(name: string) {
  return process.env[name]?.trim();
}

export async function POST(request: Request) {
  const baseUrl = env("OMNIROUTE_URL")?.replace(/\/$/, "");
  const apiKey = env("OMNIROUTE_API_KEY");
  const model = env("OMNIROUTE_MODEL") || "auto";

  if (!baseUrl || !apiKey) {
    return new Response(
      "NOVA is ready, but its OmniRoute gateway is not configured. Add OMNIROUTE_URL and OMNIROUTE_API_KEY to the Vercel production environment.",
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

    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: NOVA_SYSTEM }, ...messages],
        stream: true,
      }),
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error("OmniRoute error", upstream.status, detail);
      return new Response(
        "NOVA could not reach its model network. Please try again.",
        { status: 502 }
      );
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            if (buffer) {
              emitSseText(buffer, controller);
            }
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split("\n\n");
          buffer = events.pop() || "";

          for (const event of events) {
            emitSseText(event, controller);
          }
        } catch (error) {
          console.error("OmniRoute stream error", error);
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
        Connection: "keep-alive",
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
  controller: ReadableStreamDefaultController<Uint8Array>
) {
  const lines = event.split("\n");

  for (const line of lines) {
    if (!line.startsWith("data:")) continue;

    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;

    try {
      const json = JSON.parse(data);
      const delta = json?.choices?.[0]?.delta?.content;

      if (typeof delta === "string" && delta) {
        controller.enqueue(new TextEncoder().encode(delta));
      }
    } catch {
      // Ignore non-JSON SSE keepalive/progress frames.
    }
  }
}
