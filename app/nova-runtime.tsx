"use client";

import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";

const adapter: ChatModelAdapter = {
  async *run({ messages }) {
    const latest = messages[messages.length - 1];
    const text =
      latest?.content
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(" ")
        .trim() || "";

    const response = text
      ? `I’m NOVA. I’m ready to work on “${text}”. The intelligence layer is connected to the conversation surface now. Next, we’ll connect NOVA to real models, tools, files and actions without changing this experience.`
      : "I’m NOVA. Tell me what you want to accomplish.";

    yield { content: [{ type: "text", text: response }] };
  },
};

export function NovaRuntime({ children }: { children: React.ReactNode }) {
  const runtime = useLocalRuntime(adapter);

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
