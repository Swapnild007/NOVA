"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function NovaMarkdown({ children }: { children: string }) {
  return (
    <div className="nova-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
