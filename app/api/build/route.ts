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
  verification?: { passed?: boolean; checks?: string[] };
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
  if (!apiKey) return new Response("NOVA's build connection is not configured.", { status: 503 });

  try {
    const body = (await request.json()) as { messages?: unknown };
    const messages = sanitize(body.messages);
    if (!messages.length) return new Response("Tell NOVA what you want to build.", { status: 400 });

    const plan = createNovaPlan(messages);
    const prepared = prepareNovaMessages(messages, Math.min(plan.contextMessages, 16));

    const system = [
      "You are NOVA's autonomous product builder.",
      "You have a real isolated Linux workspace through the shell tool.",
      "Do not merely describe code. Build the requested web application in /workspace.",
      "Create index.html, styles.css and app.js. Add other files only when genuinely needed.",
      "Run real validation after writing files. At minimum verify the files exist, HTML has a body, CSS is non-empty, and JavaScript parses with Node.",
      "If validation fails, inspect the error, edit the files, and run validation again.",
      "Never claim a test passed unless you actually ran it.",
      "Keep the project self-contained and browser-runnable unless the user explicitly requests a framework or dependency.",
      "Do not use external images, scripts, CSS frameworks, tracking, or remote dependencies unless explicitly requested.",
      "Make the result polished, responsive, accessible, and interactive.",
      "When finished, read the final files and return ONLY valid JSON.",
      'Final JSON schema: {"name":"string","summary":"string","files":[{"path":"index.html","content":"string"},{"path":"styles.css","content":"string"},{"path":"app.js","content":"string"}],"verification":{"passed":true,"checks":["string"]}}',
      "Include the exact final contents of every returned file."
    ].join("\n");

    const upstream = await fetch(OPENROUTER_URL + "/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://nova-gamma-mocha.vercel.app",
        "X-Title": "NOVA Autonomous Project Builder"
      },
      body: JSON.stringify({
        model: plan.model,
        input: [
          { role: "system", content: [{ type: "input_text", text: system }] },
          {
            role: "user",
            content: [{
              type: "input_text",
              text: prepared.map((message) => message.role.toUpperCase() + ": " + message.content).join("\n\n")
            }]
          }
        ],
        tools: [{
          type: "openrouter:shell",
          parameters: {
            engine: "openrouter",
            timeout_ms: 120000,
            max_output_length: 24000
          }
        }],
        ...(plan.fallbackModels.length ? { models: plan.fallbackModels } : {}),
        max_output_tokens: 24000
      }),
      cache: "no-store"
    });

    if (!upstream.ok) {
      console.error("NOVA autonomous builder upstream error", await upstream.text().catch(() => ""));
      return new Response("NOVA could not start the build workspace right now.", { status: 502 });
    }

    const json = await upstream.json();
    const output = Array.isArray(json?.output) ? json.output : [];
    const textParts: string[] = [];

    for (const item of output) {
      if (typeof item?.text === "string") textParts.push(item.text);
      if (Array.isArray(item?.content)) {
        for (const part of item.content) {
          if (typeof part?.text === "string") textParts.push(part.text);
        }
      }
    }

    const text = textParts.join("\n").trim();
    if (!text) return new Response("NOVA received an empty build result.", { status: 502 });

    const project = extractJson(text);
    const payload = "__NOVA_PROJECT__" + JSON.stringify(project);

    return new Response(payload, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-NOVA-Intent": "build",
        "X-NOVA-Verified": project.verification?.passed ? "true" : "false"
      }
    });
  } catch (error) {
    console.error("NOVA autonomous builder error", error);
    return new Response("NOVA's autonomous builder could not complete this build.", { status: 503 });
  }
}
