"use client";

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";

const USAGE_MARKER = "__NOVA_USAGE__";

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

const adapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
        })),
      }),
      signal: abortSignal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      throw new Error(detail || "NOVA could not reach its intelligence service.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      fullText += decoder.decode(value, { stream: true });

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
