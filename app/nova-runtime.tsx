"use client";

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";

const USAGE_MARKER = "__NOVA_USAGE__";
const BUILD_MARKER = "__NOVA_PROJECT__";
const PROJECT_STORAGE_KEY = "nova-active-project";

type UsagePayload = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

function recordUsage(payload: UsagePayload) {
  try {
    const raw = localStorage.getItem("nova-usage");
    const current = raw
      ? JSON.parse(raw) as {
          requests: number;
          promptTokens: number;
          completionTokens: number;
          cost: number;
        }
      : { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };

    current.requests += 1;
    current.promptTokens += Number(payload.prompt_tokens || 0);
    current.completionTokens += Number(payload.completion_tokens || 0);
    current.cost += Number(payload.cost || 0);

    localStorage.setItem("nova-usage", JSON.stringify(current));
    window.dispatchEvent(new Event("nova-usage-updated"));
  } catch {
    // Usage is optional telemetry. Never break a conversation because it failed.
  }
}

function shouldBuild(text: string) {
  const normalized = text.trim();

  // Route explicit product-building requests to the autonomous builder.
  // The previous rule required the word "app/website/etc." later in the
  // sentence, so requests such as "Build a polished expense tracker" fell
  // through to the normal chat endpoint and NOVA simply wrote code as prose.
  if (/\b(build|create|make|develop)\b/i.test(normalized)) {
    return /\b(app|application|website|web app|web application|site|dashboard|landing page|tool|frontend|tracker|calculator|game|portfolio|editor|crm|kanban|marketplace|ecommerce|booking|form|todo|planner|workspace|portal|platform|interface|ui|project)\b/i.test(normalized)
      || /\b(build|create|make|develop)\b.{0,40}\b(from scratch|responsive|interactive|production|polished|functional)\b/i.test(normalized);
  }

  return false;
}

const adapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    try {
      const payload = {
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
        })),
        ...(typeof window !== "undefined"
          ? (() => {
              try {
                const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
                return stored ? { project: JSON.parse(stored) } : {};
              } catch {
                return {};
              }
            })()
          : {}),
      };

      const lastUser = [...payload.messages].reverse().find((message) => message.role === "user");
      const endpoint = lastUser && shouldBuild(lastUser.content) ? "/api/build" : "/api/chat";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortSignal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        yield {
          content: [{
            type: "text",
            text: detail || "NOVA could not reach its intelligence service."
          }]
        };
        return;
      }

      if (!response.body) {
        yield {
          content: [{
            type: "text",
            text: "NOVA returned an empty response. Please try again."
          }]
        };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        fullText += decoder.decode(value, { stream: true });

        if (fullText.startsWith(BUILD_MARKER)) {
          yield { content: [{ type: "text", text: fullText }] };
          continue;
        }

        const markerIndex = fullText.indexOf(USAGE_MARKER);
        if (markerIndex >= 0) {
          const visibleText = fullText.slice(0, markerIndex);
          const usageText = fullText.slice(markerIndex + USAGE_MARKER.length).trim();
          try {
            recordUsage(JSON.parse(usageText) as UsagePayload);
          } catch {
            // Ignore malformed optional usage data.
          }
          if (visibleText) {
            yield { content: [{ type: "text", text: visibleText }] };
          }
          return;
        }

        if (fullText) {
          yield { content: [{ type: "text", text: fullText }] };
        }
      }

      fullText += decoder.decode();

      if (fullText.startsWith(BUILD_MARKER)) {
        yield { content: [{ type: "text", text: fullText }] };
        return;
      }

      const markerIndex = fullText.indexOf(USAGE_MARKER);
      if (markerIndex >= 0) {
        const visibleText = fullText.slice(0, markerIndex);
        const usageText = fullText.slice(markerIndex + USAGE_MARKER.length).trim();
        try {
          recordUsage(JSON.parse(usageText) as UsagePayload);
        } catch {
          // Ignore malformed optional usage data.
        }
        if (visibleText) {
          yield { content: [{ type: "text", text: visibleText }] };
        }
      } else if (fullText) {
        yield { content: [{ type: "text", text: fullText }] };
      } else {
        yield {
          content: [{
            type: "text",
            text: "NOVA returned an empty response. The request reached the server but produced no visible result."
          }]
        };
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      yield {
        content: [{
          type: "text",
          text: error instanceof Error
            ? `NOVA could not complete the request: ${error.message}`
            : "NOVA could not complete the request."
        }]
      };
    }
  },
};

export function NovaRuntime({ children }: { children: React.ReactNode }) {
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
