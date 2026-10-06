import { createNovaPlan, prepareNovaMessages } from "../chat/nova-gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENROUTER_URL = "https://openrouter.ai/api/v1";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ProjectFile = {
  path: string;
  content: string;
};

type ProjectPayload = {
  name: string;
  summary: string;
  files: ProjectFile[];
};

function env(name: string) {
  return process.env[name]?.trim();
}

function sanitize(raw: unknown): IncomingMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (message): message is IncomingMessage =>
        !!message &&
        typeof message === "object" &&
        typeof (message as IncomingMessage).content === "string" &&
        ["user", "assistant", "system"].includes(
          (message as IncomingMessage).role
        )
    )
    .slice(-20);
}

function extractJson(text: string): ProjectPayload {
  const fenced = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i);
  const raw = fenced?.[1] || text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Builder returned invalid project JSON.");

  const parsed = JSON.parse(raw.slice(start, end + 1)) as ProjectPayload;
  if (!parsed || typeof parsed.name !== "string" || !Array.isArray(parsed.files)) {
    throw new Error("Builder returned an invalid project shape.");
  }

  const files = parsed.files
    .filter(
      (file): file is ProjectFile =>
        !!file &&
        typeof file === "object" &&
        typeof file.path === "string" &&
        typeof file.content === "string"
    )
    .slice(0, 12);

  if (!files.some((file) => file.path === "index.html")) {
    throw new Error("Builder did not produce an index.html entry point.");
  }

  return {
    name: parsed.name.slice(0, 80),
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 500) : "",
    files,
  };
}

export async function POST(request: Request) {
  const apiKey = env("OPENROUTER_API_KEY");
  if (!apiKey) {
    return new Response("NOVA's build connection is not configured.", { status: 503 });
  }

  try {
    const body = (await request.json()) as { messages?: unknown };
    const messages = sanitize(body.messages);
    if (!messages.length) return new Response("Tell NOVA what you want to build.", { status: 400 });

    const plan = createNovaPlan(messages);
    const prepared = prepareNovaMessages(messages, Math.min(plan.contextMessages, 16));

    const system = [
      "You are NOVA's product builder.",
      "Build the requested web application as a small, self-contained project that can run directly in a browser.",
      "Return ONLY valid JSON. No markdown fences. No commentary.",
      'Schema: {"name":"string","summary":"string","files":[{"path":"index.html","content":"string"}, {"path":"styles.css","content":"string"}, {"path":"app.js","content":"string"}]}',
      "Always include index.html, styles.css and app.js.",
      "Use semantic HTML, responsive CSS and real JavaScript interactions.",
      "Do not use external images, external scripts, external CSS frameworks, tracking, or remote dependencies unless the user explicitly requests them.",
      "Make the result polished and production-minded, not a toy placeholder.",
      "Keep the generated project reasonably small. Prefer a complete working experience over many files.",
      "The index.html must reference ./styles.css and ./app.js.",
    ].join("\n");

    const upstream = await fetch(OPENROUTER_URL + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nova-gamma-mocha.vercel.app",
        "X-Title": "NOVA Project Builder",
      },
      body: JSON.stringify({
        model: plan.model,
        messages: [{ role: "system", content: system }, ...prepared],
        stream: false,
        temperature: 0.2,
        response_format: { type: "json_object" },
        ...(plan.fallbackModels.length ? { models: plan.fallbackModels } : {}),
      }),
      cache: "no-store",
    });

    if (!upstream.ok) {
      console.error("NOVA builder upstream error", await upstream.text().catch(() => ""));
      return new Response("NOVA could not build the project right now.", { status: 502 });
    }

    const json = await upstream.json();
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      return new Response("NOVA received an empty build result.", { status: 502 });
    }

    const project = extractJson(text);
    const payload = "__NOVA_PROJECT__" + JSON.stringify(project);

    return new Response(payload, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-NOVA-Intent": "build",
      },
    });
  } catch (error) {
    console.error("NOVA builder error", error);
    return new Response("NOVA's project builder could not complete this build.", { status: 503 });
  }
}
