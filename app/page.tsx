"use client";

import { useEffect, useRef, useState } from "react";
import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { NovaRuntime } from "./nova-runtime";

function Message() {
  const message = useAuiState((state) => state.message);
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  if (!text) return null;

  return (
    <MessagePrimitive.Root
      className={
        message.role === "user"
          ? "message message-user"
          : "message message-assistant"
      }
    >
      <div className="message-label">
        {message.role === "user" ? "You" : "NOVA"}
      </div>
      <div className="message-text">{text}</div>
    </MessagePrimitive.Root>
  );
}

const capabilityPrompts: Record<string, string> = {
  Research: "Research this for me and give me the most useful, current answer.",
  Create: "Help me create this from scratch. Ask only what you truly need.",
  Analyze: "Analyze this carefully and give me the important findings and next steps.",
  Build: "Help me build this. Break it into practical steps and start with the first one.",
};

function setComposerValue(value: string) {
  const input = document.querySelector(
    ".composer-input"
  ) as HTMLTextAreaElement | HTMLInputElement | null;

  if (!input) return;

  const setter =
    input instanceof HTMLTextAreaElement
      ? Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value"
        )?.set
      : Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;

  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
}

function Home() {
  const [intro, setIntro] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntro(false), 950);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  return (
    <main className="nova-shell">
      <div className={`nova-intro ${intro ? "is-visible" : "is-hidden"}`}>
        <div className="intro-mark">N</div>
        <div className="intro-name">NOVA</div>
      </div>

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">N</span>
          <span>NOVA</span>
        </div>

        <div className="menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="quiet-button"
            aria-label="Open workspace menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            •••
          </button>

          {menuOpen && (
            <div className="workspace-menu">
              <button type="button" onClick={() => setComposerValue("What can you help me with?")}>
                What can you do?
              </button>
              <button type="button" onClick={() => setComposerValue("Help me plan something.")}>
                Start planning
              </button>
              <button type="button" onClick={() => setComposerValue("Help me solve a problem.")}>
                Solve a problem
              </button>
            </div>
          )}
        </div>
      </header>

      <section className="workspace">
        <div className="hero-copy">
          <span className="eyebrow">INTELLIGENCE, CONNECTED</span>
          <h1>
            What are we
            <br />
            working on?
          </h1>
          <p>Think, create, research, analyze and act from one place.</p>
        </div>

        <ThreadPrimitive.Root className="thread">
          <ThreadPrimitive.Messages components={{ Message }} />

          <ComposerPrimitive.Root className="composer">
            <ComposerPrimitive.Input
              className="composer-input"
              placeholder="Ask NOVA anything..."
              submitOnEnter
              autoFocus
            />

            <div className="composer-footer">
              <div className="composer-tools">
                <button
                  type="button"
                  className="tool-button"
                  aria-label="Add context"
                  aria-expanded={contextOpen}
                  onClick={() => setContextOpen((open) => !open)}
                >
                  +
                </button>
                <span>Context</span>
              </div>

              <ComposerPrimitive.Send
                className="send-button"
                aria-label="Send message"
              >
                <span>↑</span>
              </ComposerPrimitive.Send>
            </div>

            {contextOpen && (
              <div className="context-panel">
                <strong>Add context</strong>
                <span>Files and other context will connect here next.</span>
              </div>
            )}
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>

        <div className="capabilities" aria-label="NOVA capabilities">
          {Object.keys(capabilityPrompts).map((capability) => (
            <button
              type="button"
              key={capability}
              onClick={() => setComposerValue(capabilityPrompts[capability])}
            >
              {capability}
            </button>
          ))}
        </div>
      </section>

      <footer className="footer">
        <span>One intelligence layer.</span>
        <span>Private by design.</span>
      </footer>
    </main>
  );
}

export default function Page() {
  return (
    <NovaRuntime>
      <Home />
    </NovaRuntime>
  );
}
