"use client";

import { useEffect, useState } from "react";
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
    <MessagePrimitive.Root className={message.role === "user" ? "message message-user" : "message message-assistant"}>
      <div className="message-label">{message.role === "user" ? "You" : "NOVA"}</div>
      <div className="message-text">{text}</div>
    </MessagePrimitive.Root>
  );
}

function Home() {
  const [intro, setIntro] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntro(false), 950);
    return () => window.clearTimeout(timer);
  }, []);

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
        <button className="quiet-button" aria-label="Open workspace menu">•••</button>
      </header>

      <section className="workspace">
        <div className="hero-copy">
          <span className="eyebrow">INTELLIGENCE, CONNECTED</span>
          <h1>What are we<br />working on?</h1>
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
                <button type="button" className="tool-button" aria-label="Add context">+</button>
                <span>Context</span>
              </div>
              <ComposerPrimitive.Send className="send-button" aria-label="Send message">
                <span>↑</span>
              </ComposerPrimitive.Send>
            </div>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>

        <div className="capabilities">
          <button type="button">Research</button>
          <button type="button">Create</button>
          <button type="button">Analyze</button>
          <button type="button">Build</button>
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
