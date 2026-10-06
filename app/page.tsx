"use client";

import { useEffect, useRef, useState } from "react";
import {
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
  useAuiEvent,
  useAuiState,
} from "@assistant-ui/react";
import { NovaRuntime } from "./nova-runtime";
import { NovaMarkdown } from "./nova-markdown";

type Theme = "system" | "light" | "dark";
type SettingsSection =
  | "General"
  | "Appearance"
  | "Voice"
  | "Personalization"
  | "Data controls"
  | "Usage"
  | "Connections"
  | "About";

const capabilityPrompts: Record<string, string> = {
  Research: "Research this for me and give me the most useful, current answer.",
  Create: "Help me create this from scratch. Ask only what you truly need.",
  Analyze: "Analyze this carefully and give me the important findings and next steps.",
  Build: "Help me build this. Break it into practical steps and start with the first one.",
};

const settingsSections: SettingsSection[] = [
  "General",
  "Appearance",
  "Voice",
  "Personalization",
  "Data controls",
  "Usage",
  "Connections",
  "About",
];

type NovaSpeechResult = {
  0?: { transcript?: string };
};

type NovaSpeechResultList = ArrayLike<NovaSpeechResult>;

type NovaSpeechRecognitionEvent = {
  results: NovaSpeechResultList;
};

type NovaSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: NovaSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type NovaSpeechRecognitionConstructor = new () => NovaSpeechRecognition;

type NovaSpeechWindow = Window & {
  SpeechRecognition?: NovaSpeechRecognitionConstructor;
  webkitSpeechRecognition?: NovaSpeechRecognitionConstructor;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatUsd(value: number) {
  return value < 0.0001 ? "$0.00" : `${value.toFixed(4)}`;
}

function readLocal(key: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function loadUsage() {
  try {
    const raw = localStorage.getItem("nova-usage");
    return raw
      ? JSON.parse(raw) as {
          requests: number;
          promptTokens: number;
          completionTokens: number;
          cost: number;
        }
      : { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
  } catch {
    return { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
  }
}

function saveUsage(usage: {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
}) {
  localStorage.setItem("nova-usage", JSON.stringify(usage));
  window.dispatchEvent(new Event("nova-usage-updated"));
}

function Message() {
  const message = useAuiState((state) => state.message);
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  const speak = () => {
    if (!("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[#*_\`]/g, ""));
    utterance.lang = "en-IN";
    window.speechSynthesis.speak(utterance);
  };

  if (!text) return null;

  return (
    <MessagePrimitive.Root
      className={message.role === "user" ? "message message-user" : "message message-assistant"}
    >
      <div className="message-head">
        <div className="message-label">{message.role === "user" ? "You" : "NOVA"}</div>
        {message.role === "assistant" && (
          <button type="button" className="message-speak" onClick={speak} aria-label="Read response aloud">
            ◉
          </button>
        )}
      </div>
      <div className="message-text">
        {message.role === "assistant" ? <NovaMarkdown>{text}</NovaMarkdown> : text}
      </div>
    </MessagePrimitive.Root>
  );
}

function VoiceButton() {
  const aui = useAui();
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);

  const toggleVoice = () => {
    const speechWindow = window as NovaSpeechWindow;
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setSupported(false);
      return;
    }

    if (listening) {
      window.dispatchEvent(new Event("nova-voice-stop"));
      return;
    }

    const recognition = new Recognition() as unknown as NovaSpeechRecognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = localStorage.getItem("nova-voice-language") || "en-IN";

    let transcript = "";
    recognition.onresult = (event) => {
      transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript || "")
        .join("");
      aui.composer.setText(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    setListening(true);
    recognition.start();

    const stop = () => recognition.stop();
    window.addEventListener("nova-voice-stop", stop, { once: true });
  };

  return (
    <button
      type="button"
      className={`tool-button voice-button ${listening ? "is-listening" : ""}`}
      onClick={toggleVoice}
      aria-label={listening ? "Stop voice input" : "Start voice input"}
      title={supported ? (listening ? "Stop listening" : "Voice input") : "Voice input is not supported in this browser"}
    >
      {listening ? "■" : "⌕"}
    </button>
  );
}

function SettingsModal({
  section,
  setSection,
  onClose,
}: {
  section: SettingsSection;
  setSection: (section: SettingsSection) => void;
  onClose: () => void;
}) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem("nova-theme") as Theme) || "system";
  });
  const [memory, setMemory] = useState(() => readLocal("nova-memory", "on") !== "off");
  const [training, setTraining] = useState(() => readLocal("nova-training", "on") !== "off");
  const [temporary, setTemporary] = useState(() => readLocal("nova-temporary", "off") === "on");
  const [usage, setUsage] = useState(loadUsage);

  useEffect(() => {
    const sync = () => setUsage(loadUsage());
    window.addEventListener("nova-usage-updated", sync);
    return () => window.removeEventListener("nova-usage-updated", sync);
  }, []);

  const applyTheme = (value: Theme) => {
    setTheme(value);
    localStorage.setItem("nova-theme", value);
    document.documentElement.dataset.theme = value;
  };

  const toggle = (key: string, value: boolean, setter: (value: boolean) => void) => {
    setter(value);
    localStorage.setItem(key, value ? "on" : "off");
  };

  return (
    <div className="settings-backdrop" role="dialog" aria-modal="true" aria-label="NOVA Settings">
      <div className="settings-modal">
        <aside className="settings-nav">
          <div className="settings-title">Settings</div>
          {settingsSections.map((item) => (
            <button
              type="button"
              key={item}
              className={section === item ? "settings-nav-item active" : "settings-nav-item"}
              onClick={() => setSection(item)}
            >
              {item}
            </button>
          ))}
        </aside>

        <section className="settings-content">
          <div className="settings-header">
            <div>
              <span className="settings-kicker">NOVA</span>
              <h2>{section}</h2>
            </div>
            <button type="button" className="settings-close" onClick={onClose} aria-label="Close settings">×</button>
          </div>

          {section === "General" && (
            <div className="settings-stack">
              <SettingRow title="Language" description="Language used for the NOVA interface." value="English" />
              <SettingRow title="Response style" description="Keep responses clear, practical and context-aware." value="Balanced" />
              <SettingRow title="Intelligence routing" description="Let NOVA choose the right capability behind the single window." value="Automatic" />
            </div>
          )}

          {section === "Appearance" && (
            <div className="settings-stack">
              <SettingRow title="Theme" description="Choose how NOVA looks across devices." value="">
                <div className="segmented">
                  {(["system", "light", "dark"] as Theme[]).map((item) => (
                    <button key={item} type="button" className={theme === item ? "selected" : ""} onClick={() => applyTheme(item)}>
                      {item[0].toUpperCase() + item.slice(1)}
                    </button>
                  ))}
                </div>
              </SettingRow>
              <SettingRow title="Animations" description="Use subtle transitions and motion." value="">
                <span className="status-pill">On</span>
              </SettingRow>
            </div>
          )}

          {section === "Voice" && (
            <div className="settings-stack">
              <SettingRow title="Voice input" description="Use the microphone in the composer to dictate messages." value="">
                <span className="status-pill">Browser voice</span>
              </SettingRow>
              <SettingRow title="Language" description="Speech recognition language." value="">
                <select
                  value={readLocal("nova-voice-language", "en-IN")}
                  onChange={(event) => localStorage.setItem("nova-voice-language", event.target.value)}
                >
                  <option value="en-IN">English (India)</option>
                  <option value="en-US">English (US)</option>
                  <option value="hi-IN">Hindi (India)</option>
                  <option value="mr-IN">Marathi (India)</option>
                </select>
              </SettingRow>
              <SettingRow title="Read responses aloud" description="Use your device speech engine to play NOVA responses." value="">
                <span className="status-pill">Available</span>
              </SettingRow>
            </div>
          )}

          {section === "Personalization" && (
            <div className="settings-stack">
              <SettingRow title="Memory" description="Allow NOVA to use saved preferences and context when available." value="">
                <Toggle checked={memory} onChange={(value) => toggle("nova-memory", value, setMemory)} />
              </SettingRow>
              <SettingRow title="Response preferences" description="NOVA should adapt to your requested format and level of detail." value="">
                <span className="status-pill">On</span>
              </SettingRow>
            </div>
          )}

          {section === "Data controls" && (
            <div className="settings-stack">
              <SettingRow title="Improve NOVA" description="Control whether eligible conversations may be used to improve the service." value="">
                <Toggle checked={training} onChange={(value) => toggle("nova-training", value, setTraining)} />
              </SettingRow>
              <SettingRow title="Temporary chat" description="Keep this session out of the normal local conversation state." value="">
                <Toggle checked={temporary} onChange={(value) => toggle("nova-temporary", value, setTemporary)} />
              </SettingRow>
              <button type="button" className="danger-button" onClick={() => localStorage.removeItem("nova-usage")}>
                Clear local usage data
              </button>
            </div>
          )}

          {section === "Usage" && (
            <div className="settings-stack">
              <div className="usage-grid">
                <UsageCard label="Requests" value={formatNumber(usage.requests)} />
                <UsageCard label="Prompt tokens" value={formatNumber(usage.promptTokens)} />
                <UsageCard label="Output tokens" value={formatNumber(usage.completionTokens)} />
                <UsageCard label="Estimated cost" value={formatUsd(usage.cost)} />
              </div>
              <SettingRow title="AI connection" description="NOVA currently routes through its server-side OpenRouter connection." value="">
                <span className="status-pill success">Connected</span>
              </SettingRow>
              <SettingRow title="API key" description="Secret stays on the server. NOVA never exposes the key to the browser." value="">
                <span className="status-pill">Server-side</span>
              </SettingRow>
              <p className="settings-note">Usage values are collected from the model response when the provider returns accounting data. Your secret key is never displayed here.</p>
            </div>
          )}

          {section === "Connections" && (
            <div className="settings-stack">
              <SettingRow title="OpenRouter" description="Unified model gateway currently connected to NOVA." value="">
                <span className="status-pill success">Connected</span>
              </SettingRow>
              <SettingRow title="More providers" description="The architecture is ready for additional model providers without changing the chat surface." value="">
                <span className="status-pill">Planned</span>
              </SettingRow>
              <SettingRow title="Files, web and actions" description="These capabilities will plug into the same conversation instead of creating separate apps." value="">
                <span className="status-pill">Single window</span>
              </SettingRow>
            </div>
          )}

          {section === "About" && (
            <div className="settings-stack">
              <SettingRow title="NOVA" description="One intelligence layer for thinking, creating, researching and acting." value="0.4" />
              <SettingRow title="Architecture" description="Web and mobile interface with a server-side model gateway." value="NOVA Core" />
              <p className="settings-note">NOVA is designed as one conversation surface over multiple models, tools and capabilities. The machinery stays behind the window.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SettingRow({
  title,
  description,
  value,
  children,
}: {
  title: string;
  description: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {children || <span className="setting-value">{value}</span>}
    </div>
  );
}

function UsageCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="usage-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      className={checked ? "toggle on" : "toggle"}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span />
    </button>
  );
}

function Home() {
  const aui = useAui();
  const isEmpty = useAuiState((state) => state.thread.isEmpty);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const messages = useAuiState((state) => state.thread.messages);
  const [intro, setIntro] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("General");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntro(false), 950);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const stored = (localStorage.getItem("nova-theme") as Theme) || "system";
    document.documentElement.dataset.theme = stored;
  }, []);

  useAuiEvent("composer.send", () => {
    const current = loadUsage();
    current.requests += 1;
    saveUsage(current);
  });

  useAuiEvent("thread.runEnd", () => {
    const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    const output = lastAssistant?.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("") || "";
    const prompt = lastUser?.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("") || "";
    const current = loadUsage();
    current.promptTokens += Math.max(1, Math.ceil(prompt.length / 4));
    current.completionTokens += Math.max(1, Math.ceil(output.length / 4));
    saveUsage(current);
  });

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const setComposerValue = (value: string) => {
    aui.composer.setText(value);
    setMenuOpen(false);
  };

  return (
    <main className={`nova-shell ${isEmpty ? "is-empty" : "has-chat"}`}>
      <div className={`nova-intro ${intro ? "is-visible" : "is-hidden"}`}>
        <div className="intro-mark">N</div>
        <div className="intro-name">NOVA</div>
      </div>

      <header className="topbar">
        <button type="button" className="brand brand-button" onClick={() => aui.thread.reset()}>
          <span className="brand-mark">N</span>
          <span>NOVA</span>
        </button>

        <div className="topbar-actions">
          {!isEmpty && (
            <button type="button" className="new-chat-button" onClick={() => aui.thread.reset()}>
              New chat
            </button>
          )}
          <div className="menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="quiet-button"
              aria-label="Open NOVA menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              •••
            </button>

            {menuOpen && (
              <div className="workspace-menu">
                <button type="button" onClick={() => setComposerValue("What can you help me with?")}>What can you do?</button>
                <button type="button" onClick={() => setComposerValue("Help me plan something.")}>Start planning</button>
                <button type="button" onClick={() => setComposerValue("Help me solve a problem.")}>Solve a problem</button>
                <div className="menu-divider" />
                <button type="button" onClick={() => { setSettingsOpen(true); setMenuOpen(false); }}>Settings</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <section className="workspace">
        <AuiIf condition={(state) => state.thread.isEmpty}>
          <div className="hero-copy">
            <span className="eyebrow">INTELLIGENCE, CONNECTED</span>
            <h1>What are we<br />working on?</h1>
            <p>Think, create, research, analyze and act from one place.</p>
          </div>
        </AuiIf>

        <ThreadPrimitive.Root className="thread">
          <ThreadPrimitive.Viewport className="thread-viewport">
            <ThreadPrimitive.Messages>
              {() => <Message />}
            </ThreadPrimitive.Messages>
          </ThreadPrimitive.Viewport>

          <ThreadPrimitive.ViewportFooter className="thread-footer">
            <ComposerPrimitive.Root className="composer">
              <ComposerPrimitive.Input
                className="composer-input"
                placeholder="Ask NOVA anything..."
                submitOnEnter
                autoFocus
              />

              <div className="composer-footer">
                <div className="composer-tools">
                  <div className="composer-menu-wrap">
                    <button
                      type="button"
                      className={composerMenuOpen ? "tool-button is-active" : "tool-button"}
                      aria-label="Open tools"
                      aria-expanded={composerMenuOpen}
                      onClick={() => setComposerMenuOpen((open) => !open)}
                    >
                      +
                    </button>

                    {composerMenuOpen && (
                      <div className="composer-menu" role="menu">
                        <button type="button" role="menuitem" onClick={() => { aui.composer.setText("Add photos or files to this conversation."); setComposerMenuOpen(false); }}>
                          <span className="composer-menu-icon">＋</span>
                          <span><strong>Add photos & files</strong></span>
                        </button>
                        <button type="button" role="menuitem" onClick={() => { aui.composer.setText("Create an image for me."); setComposerMenuOpen(false); }}>
                          <span className="composer-menu-icon">✦</span>
                          <span><strong>Create image</strong></span>
                        </button>
                        <button type="button" role="menuitem" onClick={() => { aui.composer.setText("Do deep research on this."); setComposerMenuOpen(false); }}>
                          <span className="composer-menu-icon">◎</span>
                          <span><strong>Deep research</strong></span>
                        </button>
                        <button type="button" role="menuitem" onClick={() => { aui.composer.setText("Search the web for this."); setComposerMenuOpen(false); }}>
                          <span className="composer-menu-icon">⌕</span>
                          <span><strong>Web search</strong></span>
                        </button>
                        <button type="button" role="menuitem" onClick={() => setComposerMenuOpen(false)}>
                          <span className="composer-menu-icon">•••</span>
                          <span><strong>More</strong></span>
                        </button>
                      </div>
                    )}
                  </div>
                  <VoiceButton />
                </div>

                <div className="composer-actions">
                  <AuiIf condition={(state) => state.thread.isRunning}>
                    <button type="button" className="stop-button" onClick={() => aui.thread.cancelRun()} aria-label="Stop response">■</button>
                  </AuiIf>
                  <ComposerPrimitive.Send className="send-button" aria-label="Send message">
                    <span>↑</span>
                  </ComposerPrimitive.Send>
                </div>
              </div>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.ViewportFooter>
        </ThreadPrimitive.Root>

        {isEmpty && (
          <div className="capabilities" aria-label="NOVA capabilities">
            {Object.keys(capabilityPrompts).map((capability) => (
              <button type="button" key={capability} onClick={() => aui.composer.setText(capabilityPrompts[capability])}>
                {capability}
              </button>
            ))}
          </div>
        )}

        {isRunning && <div className="run-status"><span /> NOVA is working</div>}
      </section>

      <footer className="footer">
        <span>One intelligence layer.</span>
        <span>Private by design.</span>
      </footer>

      {settingsOpen && (
        <SettingsModal
          section={settingsSection}
          setSection={setSettingsSection}
          onClose={() => setSettingsOpen(false)}
        />
      )}
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
