"use client";

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";

const USAGE_MARKER = "__NOVA_USAGE__";
const PENDING_ATTACHMENT_KEY = "nova-pending-attachment";

type UsagePayload = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

type PendingAttachment = {
  name: string;
  type: string;
  dataUrl: string;
  size: number;
};

type NovaContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };

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

function getPendingAttachment(): PendingAttachment | null {
  try {
    const raw = localStorage.getItem(PENDING_ATTACHMENT_KEY);
    if (!raw) return null;
    const attachment = JSON.parse(raw) as PendingAttachment;
    if (!attachment?.name || !attachment?.dataUrl) return null;
    return attachment;
  } catch {
    return null;
  }
}

function textFromDataUrl(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return "";
  try {
    return decodeURIComponent(
      atob(dataUrl.slice(comma + 1))
        .split("")
        .map((char) => "%" + char.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
  } catch {
    return "";
  }
}

const adapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const pendingAttachment = getPendingAttachment();

    const outgoingMessages = messages.map((message, index) => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");

      if (index !== messages.length - 1 || message.role !== "user" || !pendingAttachment) {
        return {
          role: message.role,
          content: text,
        };
      }

      const isImage = /^image\/(png|jpe?g|webp)$/i.test(pendingAttachment.type);
      const isPdf = pendingAttachment.type === "application/pdf";

      if (isImage) {
        return {
          role: message.role,
          content: [
            { type: "text", text },
            {
              type: "image_url",
              image_url: { url: pendingAttachment.dataUrl },
            },
          ] satisfies NovaContentPart[],
        };
      }

      if (isPdf) {
        return {
          role: message.role,
          content: [
            { type: "text", text },
            {
              type: "file",
              file: {
                filename: pendingAttachment.name,
                file_data: pendingAttachment.dataUrl,
              },
            },
          ] satisfies NovaContentPart[],
        };
      }

      const extracted = textFromDataUrl(pendingAttachment.dataUrl);
      return {
        role: message.role,
        content: extracted
          ? [
              {
                type: "text",
                text: `${text}\n\nAttached file: ${pendingAttachment.name}\n\n${extracted}`,
              },
            ]
          : text,
      };
    });

    localStorage.removeItem(PENDING_ATTACHMENT_KEY);
    window.dispatchEvent(new Event("nova-attachment-consumed"));

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: outgoingMessages }),
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
