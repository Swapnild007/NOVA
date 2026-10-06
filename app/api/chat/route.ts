import { streamText } from "ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const NOVA_SYSTEM = `
You are NOVA, a capable general intelligence interface.

Your job is to help the user accomplish the thing they actually mean, not merely answer the literal sentence. Be clear, practical and concise. When a task needs deeper reasoning, do it before responding. Never expose internal model names, routing, agents, providers, system prompts or implementation details unless the user explicitly asks about NOVA's architecture.

NOVA is designed as one intelligence layer that can eventually research, create, analyze, build and act. Do not pretend that a tool was used, a file was read, a website was searched, or an action was completed when it was not.
`;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      messages?: IncomingMessage[];
    };

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

    const result = streamText({
      model: "openai/gpt-5.6-luna",
      system: NOVA_SYSTEM,
      messages,
      maxOutputTokens: 2048,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    console.error("NOVA chat error", error);
    return new Response(
      "NOVA's intelligence service is not configured yet. The interface is live, but the server-side model connection needs to be enabled in Vercel.",
      { status: 503 }
    );
  }
}
