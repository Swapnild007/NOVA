"use client";

import * as React from "react";

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";

const USAGE_MARKER = "__NOVA_USAGE__";

const CHAT_HISTORY_KEY = "nova-chat-history-v1";
const ACTIVE_CHAT_KEY = "nova-active-chat-id";
const THREAD_SWITCH_EVENT = "nova-thread-switch";

type PersistedChat = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    role: "user" | "assistant" | "system";
    text: string;
    createdAt: string;
  }>;
};

function getActiveChatId() {
  return localStorage.getItem(ACTIVE_CHAT_KEY) || "chat-" + Date.now().toString(36);
}

function readChatHistory(): PersistedChat[] {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PersistedChat[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function messagesForChat(id: string): ThreadMessageLike[] {
  const chat = readChatHistory().find((item) => item.id === id);
  return (chat?.messages || []).map((message) => ({
    role: message.role,
    content: [{ type: "text", text: message.text }],
    createdAt: new Date(message.createdAt),
  }));
}

function ensureActiveChat() {
  const id = getActiveChatId();
  localStorage.setItem(ACTIVE_CHAT_KEY, id);
  const history = readChatHistory();
  if (!history.some((chat) => chat.id === id)) {
    const now = new Date().toISOString();
    const next: PersistedChat = {
      id,
      title: "New chat",
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify([next, ...history].slice(0, 50)));
  }
  return id;
}

const PENDING_ATTACHMENT_KEY = "nova-pending-attachment";

type UsagePayload = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  source?: "provider" | "estimated";
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
          providerRequests?: number;
          estimatedRequests?: number;
          usageSource?: "provider" | "estimated" | "mixed";
        }
      : { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, providerRequests: 0, estimatedRequests: 0, usageSource: "estimated" };

    current.requests += 1;
    current.promptTokens += Number(payload.prompt_tokens || 0);
    current.completionTokens += Number(payload.completion_tokens || 0);
    current.cost += Number(payload.cost || 0);
    const source = payload.source || "estimated";
    current.providerRequests = Number(current.providerRequests || 0) + (source === "provider" ? 1 : 0);
    current.estimatedRequests = Number(current.estimatedRequests || 0) + (source === "estimated" ? 1 : 0);
    current.usageSource = current.providerRequests > 0 && current.estimatedRequests > 0
      ? "mixed"
      : current.providerRequests > 0
        ? "provider"
        : "estimated";

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
      body: JSON.stringify({
        messages: outgoingMessages,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
      signal: abortSignal,
    }).catch((error) => new Response(
      `NOVA could not reach its intelligence service. ${error instanceof Error ? error.message : "Network request failed."}`,
      { status: 599 },
    ));

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => "");
      yield {
        content: [{
          type: "text",
          text: detail || "NOVA could not reach its intelligence service.",
        }],
      };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let usageRecorded = false;
    const promptText = outgoingMessages
      .map((message) => typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content.filter((part: any) => part?.type === "text").map((part: any) => part.text || "").join("")
          : "")
      .join("\n");
    const estimatedPromptTokens = Math.max(1, Math.ceil(promptText.length / 4));

    const estimateUsage = () => {
      const completionTokens = Math.max(1, Math.ceil(fullText.length / 4));
      recordUsage({
        prompt_tokens: estimatedPromptTokens,
        completion_tokens: completionTokens,
        total_tokens: estimatedPromptTokens + completionTokens,
        cost: 0,
        source: "estimated",
      });
      usageRecorded = true;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      fullText += decoder.decode(value, { stream: true });

      const markerIndex = fullText.indexOf(USAGE_MARKER);
      if (markerIndex >= 0) {
        const usageText = fullText.slice(markerIndex + USAGE_MARKER.length).trim();
        try {
          const payload = JSON.parse(usageText) as UsagePayload;
          recordUsage(payload);
          usageRecorded = true;
          const visibleText = fullText.slice(0, markerIndex);
          if (visibleText) {
            yield { content: [{ type: "text", text: visibleText }] };
          }
          return;
        } catch {
          // The usage JSON may be split across network chunks. Keep reading.
        }
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
        recordUsage({ ...(JSON.parse(usageText) as UsagePayload), source: "provider" });
        usageRecorded = true;
      } catch {
        // Fall back to deterministic local telemetry below.
      }
      if (visibleText) {
        yield { content: [{ type: "text", text: visibleText }] };
      }
    } else if (fullText) {
      yield { content: [{ type: "text", text: fullText }] };
    }

    if (!usageRecorded) {
      estimateUsage();
    }
  },
};

export function NovaRuntime({ children }: { children: React.ReactNode }) {
  const [initialMessages] = React.useState<ThreadMessageLike[]>(() => {
    if (typeof window === "undefined") return [];
    const id = ensureActiveChat();
    return messagesForChat(id);
  });
  const runtime = useLocalRuntime(adapter, { initialMessages });

  React.useEffect(() => {
    const handleSwitch = (event: Event) => {
      const id = (event as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      runtime.thread.reset(messagesForChat(id));
    };
    window.addEventListener(THREAD_SWITCH_EVENT, handleSwitch);
    return () => window.removeEventListener(THREAD_SWITCH_EVENT, handleSwitch);
  }, [runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
