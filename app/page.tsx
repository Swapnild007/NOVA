"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionBarPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
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

const BUILD_MARKER = "__NOVA_PROJECT__";
const PENDING_ATTACHMENT_KEY = "nova-pending-attachment";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

type NovaAttachment = {
  name: string;
  type: string;
  dataUrl: string;
  size: number;
};
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

function loadChatHistory(): PersistedChat[] {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) as PersistedChat[] : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveChatHistory(chats: PersistedChat[]) {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chats.slice(0, 50)));
  } catch {
    // History is best-effort local persistence.
  }
}

function activeChatId() {
  return localStorage.getItem(ACTIVE_CHAT_KEY) || "";
}

function ensureChatRecord(id: string) {
  const chats = loadChatHistory();
  if (chats.some((chat) => chat.id === id)) return chats;
  const now = new Date().toISOString();
  const next: PersistedChat = {
    id,
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  const updated = [next, ...chats];
  saveChatHistory(updated);
  return updated;
}

function newChatId() {
  return "chat-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function messageText(message: { content: readonly { type: string; text?: string }[] }) {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text || "")
    .join("");
}

function persistChatMessages(id: string, messages: readonly { role: "user" | "assistant" | "system"; content: readonly { type: string; text?: string }[]; createdAt?: Date }[]) {
  const chats = ensureChatRecord(id);
  const now = new Date().toISOString();
  const persisted = messages
    .map((message) => ({
      role: message.role,
      text: messageText(message).slice(0, 30000),
      createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : now,
    }))
    .filter((message) => message.text.length > 0);
  const firstUser = persisted.find((message) => message.role === "user");
  const updated = chats.map((chat) =>
    chat.id === id
      ? {
          ...chat,
          title: chat.title === "New chat" && firstUser ? firstUser.text.replace(/\s+/g, " ").trim().slice(0, 72) || "New chat" : chat.title,
          updatedAt: now,
          messages: persisted,
        }
      : chat
  );
  saveChatHistory(updated);
  window.dispatchEvent(new Event("nova-chat-history-updated"));
}

const PROJECT_STORAGE_KEY = "nova-active-project";

type NovaProjectFile = { path: string; content: string };
type NovaProject = { name: string; summary: string; files: NovaProjectFile[] };

function parseNovaProject(text: string): NovaProject | null {
  if (!text.startsWith(BUILD_MARKER)) return null;
  try {
    const parsed = JSON.parse(text.slice(BUILD_MARKER.length)) as NovaProject;
    if (!parsed?.name || !Array.isArray(parsed.files)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildPreview(files: NovaProjectFile[]) {
  const index = files.find((file) => file.path === "index.html")?.content || "";
  const css = files.find((file) => file.path === "styles.css")?.content || "";
  const js = files.find((file) => file.path === "app.js")?.content || "";

  // Keep the preview renderer self-contained so generated workspaces do not
  // depend on relative asset URLs inside the sandboxed iframe.
  const withoutExternalAssets = index
    .replace(/<link[^>]*href=["']styles\.css["'][^>]*>/gi, "")
    .replace(/<script[^>]*src=["']app\.js["'][^>]*><\/script>/gi, "");

  return withoutExternalAssets
    .replace("</head>", "<style>\n" + css + "\n</style>\n</head>")
    .replace("</body>", "<script>\n" + js + "\n</script>\n</body>");
}

function ProjectArtifact({ project }: { project: NovaProject }) {
  const [files, setFiles] = useState(project.files);
  const [selected, setSelected] = useState(project.files[0]?.path || "index.html");
  const [view, setView] = useState<"preview" | "code">("preview");
  const active = files.find((file) => file.path === selected) || files[0];
  const preview = useMemo(() => buildPreview(files), [files]);

  useEffect(() => {
    try {
      localStorage.setItem(
        PROJECT_STORAGE_KEY,
        JSON.stringify({
          name: project.name,
          summary: project.summary,
          files,
        })
      );
    } catch {
      // Local persistence is optional and must never interrupt editing.
    }
  }, [project.name, project.summary, files]);

  const updateActive = (content: string) => {
    if (!active) return;
    setFiles((current) => current.map((file) => file.path === active.path ? { ...file, content } : file));
  };

  return (
    <section className="project-artifact">
      <div className="project-artifact-head">
        <div>
          <span className="project-kicker">WORKSPACE</span>
          <h3>{project.name}</h3>
          <p>{project.summary}</p>
        </div>
        <div className="project-view-toggle">
          <button type="button" className={view === "preview" ? "selected" : ""} onClick={() => setView("preview")}>Preview</button>
          <button type="button" className={view === "code" ? "selected" : ""} onClick={() => setView("code")}>Code</button>
        </div>
      </div>

      <div className="project-artifact-body">
        <aside className="project-files">
          {files.map((file) => (
            <button type="button" key={file.path} className={selected === file.path ? "selected" : ""} onClick={() => setSelected(file.path)}>
              <span>{file.path.split("/").pop()}</span>
            </button>
          ))}
        </aside>

        <div className="project-stage">
          {view === "preview" ? (
            <iframe title={project.name + " preview"} className="project-preview" sandbox="allow-scripts" srcDoc={preview} />
          ) : (
            <textarea
              className="project-editor"
              value={active?.content || ""}
              onChange={(event) => updateActive(event.target.value)}
              spellCheck={false}
              aria-label={active?.path || "Project file"}
            />
          )}
        </div>
      </div>
    </section>
  );
}

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
          providerRequests?: number;
          estimatedRequests?: number;
          usageSource?: "provider" | "estimated" | "mixed";
        }
: { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, providerRequests: 0, estimatedRequests: 0, usageSource: "estimated" };
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
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const isEditing = useAuiState((state) => state.composer.isEditing);
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  const speak = () => {
    if (!("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.replace(/[#*_]/g, "").replace(/`/g, ""));
    utterance.lang = "en-IN";
    window.speechSynthesis.speak(utterance);
  };

  if (!text) {
    if (message.role !== "assistant") return null;
    return (
      <MessagePrimitive.Root className="message message-assistant">
        <div className="message-head">
          <div className="message-label">NOVA</div>
        </div>
        {isRunning && <div className="project-building">Working on it…</div>}
        <ErrorPrimitive.Root className="message-error">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Root>
    );
  }

  const project = parseNovaProject(text);
  if (text.startsWith(BUILD_MARKER)) {
    return (
      <MessagePrimitive.Root className="message message-assistant">
        {project ? <ProjectArtifact project={project} /> : <div className="project-building">Building your workspace…</div>}
        <ErrorPrimitive.Root className="message-error">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Root>
    );
  }

  return (
    <MessagePrimitive.Root className={message.role === "user" ? "message message-user" : "message message-assistant"}>
      {isEditing ? (
        <ComposerPrimitive.Root className="message-edit-composer">
          <ComposerPrimitive.Input className="message-edit-input" autoFocus aria-label="Edit message" />
          <div className="message-edit-actions">
            <ComposerPrimitive.Cancel className="message-action-button">Cancel</ComposerPrimitive.Cancel>
            <ComposerPrimitive.Send className="message-action-button message-action-primary">Save</ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      ) : (
        <>
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
          <ActionBarPrimitive.Root hideWhenRunning autohide="not-last" className="message-actions">
            <ActionBarPrimitive.Copy className="message-action-button" copiedDuration={2000}>Copy</ActionBarPrimitive.Copy>
            {message.role === "user" ? (
              <ActionBarPrimitive.Edit className="message-action-button">Edit</ActionBarPrimitive.Edit>
            ) : (
              <>
                <ActionBarPrimitive.Reload className="message-action-button">Regenerate</ActionBarPrimitive.Reload>
                <ActionBarPrimitive.FeedbackPositive className="message-action-button">Helpful</ActionBarPrimitive.FeedbackPositive>
                <ActionBarPrimitive.FeedbackNegative className="message-action-button">Not helpful</ActionBarPrimitive.FeedbackNegative>
              </>
            )}
          </ActionBarPrimitive.Root>
        </>
      )}
      <ErrorPrimitive.Root className="message-error">
        <ErrorPrimitive.Message />
      </ErrorPrimitive.Root>
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
              <SettingRow title="AI connection" description="NOVA routes through its server-side direct-provider router." value="">
                <span className="status-pill">Server-side router</span>
              </SettingRow>
              <SettingRow title="API key" description="Secret stays on the server. NOVA never exposes the key to the browser." value="">
                <span className="status-pill">Server-side</span>
              </SettingRow>
              <div className="usage-source">
                <span className="settings-note">
                  {usage.usageSource === "provider"
                    ? "Provider-reported usage"
                    : usage.usageSource === "mixed"
                      ? "Mixed: provider-reported and estimated usage"
                      : "Estimated usage"}
                </span>
                <span className="status-pill">
                  {usage.usageSource === "provider" ? "Reported" : usage.usageSource === "mixed" ? "Mixed" : "Estimated"}
                </span>
              </div>
              <p className="settings-note">
                Provider-reported usage is used when the model supplies accounting data. Otherwise NOVA estimates tokens locally. Estimates are not billing data. Your secret key is never displayed here.
              </p>
            </div>
          )}

          {section === "Connections" && (
            <div className="settings-stack">
              <SettingRow title="Direct AI providers" description="NOVA can route directly to configured free providers without an aggregator." value="">
                <span className="status-pill">Configurable</span>
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

function ChatHistoryPanel({
  chats,
  activeId,
  search,
  setSearch,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onClose,
}: {
  chats: PersistedChat[];
  activeId: string;
  search: string;
  setSearch: (value: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const filtered = chats.filter((chat) => chat.title.toLowerCase().includes(search.toLowerCase().trim()));

  return (
    <div className="history-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <aside className="history-panel" aria-label="Chat history">
        <div className="history-header">
          <div>
            <span className="history-kicker">NOVA</span>
            <h2>Chat history</h2>
          </div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close chat history">×</button>
        </div>

        <button type="button" className="history-new" onClick={onNew}>＋ New chat</button>

        <div className="history-search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search chats" aria-label="Search chats" />
        </div>

        <div className="history-list">
          {filtered.length === 0 ? (
            <div className="history-empty">No chats found.</div>
          ) : (
            filtered.map((chat) => (
              <div key={chat.id} className={chat.id === activeId ? "history-item active" : "history-item"}>
                <button type="button" className="history-item-main" onClick={() => onSelect(chat.id)}>
                  <strong>{chat.title || "New chat"}</strong>
                  <span>{new Date(chat.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                </button>
                <div className="history-item-actions">
                  <button type="button" onClick={() => onRename(chat.id)} aria-label={`Rename ${chat.title}`} title="Rename">✎</button>
                  <button type="button" onClick={() => onDelete(chat.id)} aria-label={`Delete ${chat.title}`} title="Delete">×</button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="history-footer">Chats are stored locally on this device for now.</div>
      </aside>
    </div>
  );
}

function NovaSideRail({ isEmpty, chats, onNew, onHistory, onSettings, onPrompt }: { isEmpty:boolean; chats:PersistedChat[]; onNew:()=>void; onHistory:()=>void; onSettings:()=>void; onPrompt:(text:string)=>void }) {
  const nav = [
    ["⌂","Home",""],["◷","Chat History","history"],["✓","Tasks","Plan something for me."],["□","Projects","Help me organize my projects."],
    ["◇","Memory","What do you remember about me?"],["◎","Goals","Help me define my goals."],["▣","Calendar","Help me plan my schedule."],["▤","Files","Analyze my files."],
    ["⌘","Connected Apps","Show me what I can connect."],["↻","Automations","What could NOVA automate for me?"],["✧","Explore Tools","What tools can NOVA use?"]
  ] as const;
  return <aside className="nova-side-rail" aria-label="NOVA workspace navigation">
    <div className="side-brand"><span className="side-brand-mark">N</span><span>NOVA</span></div>
    <button type="button" className="side-new-chat" onClick={onNew}><span>＋</span><strong>New Chat</strong><kbd>Ctrl K</kbd></button>
    <nav className="side-nav">{nav.map(([icon,label,value]) => <button type="button" key={label} className={label==="Home"&&isEmpty?"side-nav-item active":"side-nav-item"} onClick={() => label==="Chat History"?onHistory():value?onPrompt(value):undefined}><span className="side-nav-icon">{icon}</span><span>{label}</span></button>)}</nav>
    <div className="side-divider" />
    <div className="side-recent-head"><span>Recent Chats</span><button type="button" onClick={onHistory}>View all</button></div>
    <div className="side-recent">{chats.slice(0,7).map(chat=><button type="button" key={chat.id} onClick={onHistory} title={chat.title}><span>▱</span>{chat.title||"New chat"}</button>)}{chats.length===0&&<span className="side-empty">Your conversations appear here.</span>}</div>
    <button type="button" className="side-profile" onClick={onSettings}><span className="side-avatar">S</span><span><strong>Swapnil</strong><small>Personal NOVA</small></span><span className="side-gear">⚙</span></button>
  </aside>;
}
function NovaRightRail({ isRunning, messageCount, onPrompt }: { isRunning:boolean; messageCount:number; onPrompt:(text:string)=>void }) {
  return <aside className="nova-right-rail" aria-label="NOVA status">
    <section className="status-card"><div className="status-card-head"><strong>NOVA Status</strong><span className="online-pill"><i /> Online</span></div>
      <div className="status-grid"><div><span>◉</span><small>Thinking</small><strong>Adaptive</strong></div><div><span>◈</span><small>Memory</small><strong>Active</strong></div><div><span>⌘</span><small>Tools</small><strong>Connected</strong></div><div><span>✓</span><small>Verification</small><strong>Enabled</strong></div></div>
    </section>
    <section className="status-card"><div className="status-card-head"><strong>Today's Activity</strong><button type="button">View all</button></div>
      <div className="activity-list"><div><span>✓</span><p><strong>{messageCount}</strong> messages in this workspace</p></div><div><span>◌</span><p>Adaptive reasoning is ready</p></div><div><span>◇</span><p>Memory context is available</p></div><div><span>⌁</span><p>{isRunning?"NOVA is working now":"No active task"}</p></div></div>
    </section>
    <section className="status-card quick-card"><div className="status-card-head"><strong>Quick Start</strong></div>
      <button type="button" onClick={()=>onPrompt("Research this topic deeply and give me a verified answer with sources.")}>Deep Research <span>→</span></button>
      <button type="button" onClick={()=>onPrompt("Analyze this carefully and give me the important findings and next steps.")}>Analyze <span>→</span></button>
      <button type="button" onClick={()=>onPrompt("Help me build this step by step and validate the implementation.")}>Build <span>→</span></button>
    </section>
    <section className="insight-card"><span className="insight-icon">✦</span><strong>NOVA Intelligence</strong><p>One conversation surface over models, memory, tools, planning and verification.</p></section>
  </aside>;
}
function Home() {
  const aui = useAui();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachment, setAttachment] = useState<NovaAttachment | null>(null);
  const isEmpty = useAuiState((state) => state.thread.isEmpty);
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const messages = useAuiState((state) => state.thread.messages);
  const [intro, setIntro] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("General");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [activeChat, setActiveChat] = useState("");
  const [chatHistory, setChatHistory] = useState<PersistedChat[]>([]);
  const skipHistoryPersist = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = activeChatId() || newChatId();
    const chats = ensureChatRecord(id);
    localStorage.setItem(ACTIVE_CHAT_KEY, id);
    setActiveChat(id);
    setChatHistory(chats);
  }, []);

  useEffect(() => {
    if (!activeChat || skipHistoryPersist.current) {
      if (skipHistoryPersist.current) skipHistoryPersist.current = false;
      return;
    }
    persistChatMessages(activeChat, messages);
    setChatHistory(loadChatHistory());
  }, [messages, activeChat]);

  useEffect(() => {
    const timer = window.setTimeout(() => setIntro(false), 950);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const stored = (localStorage.getItem("nova-theme") as Theme) || "system";
    document.documentElement.dataset.theme = stored;
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const switchChat = (id: string) => {
    if (id === activeChat) {
      setHistoryOpen(false);
      return;
    }
    persistChatMessages(activeChat, aui.thread.getState().messages);
    skipHistoryPersist.current = true;
    localStorage.setItem(ACTIVE_CHAT_KEY, id);
    setActiveChat(id);
    setChatHistory(loadChatHistory());
    window.dispatchEvent(new CustomEvent(THREAD_SWITCH_EVENT, { detail: { id } }));
    setHistoryOpen(false);
  };

  const createChat = () => {
    persistChatMessages(activeChat, aui.thread.getState().messages);
    const id = newChatId();
    const chats = ensureChatRecord(id);
    skipHistoryPersist.current = true;
    localStorage.setItem(ACTIVE_CHAT_KEY, id);
    setActiveChat(id);
    setChatHistory(chats);
    window.dispatchEvent(new CustomEvent(THREAD_SWITCH_EVENT, { detail: { id } }));
    setHistoryOpen(false);
    setHistorySearch("");
  };

  const renameChat = (id: string) => {
    const chat = loadChatHistory().find((item) => item.id === id);
    if (!chat) return;
    const title = window.prompt("Rename chat", chat.title);
    if (!title?.trim()) return;
    const chats = loadChatHistory().map((item) => item.id === id ? { ...item, title: title.trim().slice(0, 72), updatedAt: new Date().toISOString() } : item);
    saveChatHistory(chats);
    setChatHistory(chats);
  };

  const deleteChat = (id: string) => {
    const chats = loadChatHistory();
    if (chats.length <= 1) {
      createChat();
      return;
    }
    const remaining = chats.filter((chat) => chat.id !== id);
    saveChatHistory(remaining);
    if (id === activeChat) {
      const next = remaining[0];
      skipHistoryPersist.current = true;
      localStorage.setItem(ACTIVE_CHAT_KEY, next.id);
      setActiveChat(next.id);
      window.dispatchEvent(new CustomEvent(THREAD_SWITCH_EVENT, { detail: { id: next.id } }));
    }
    setChatHistory(remaining);
  };

  const setComposerValue = (value: string) => {
    aui.composer.setText(value);
    setMenuOpen(false);
  };

  const chooseAttachment = () => {
    fileInputRef.current?.click();
  };

  const handleAttachment = (file: File) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      aui.composer.setText("That file is larger than 8 MB. Please choose a smaller file.");
      setComposerMenuOpen(false);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) return;

      const next = {
        name: file.name,
        type: file.type || "application/octet-stream",
        dataUrl,
        size: file.size,
      };

      try {
        localStorage.setItem(PENDING_ATTACHMENT_KEY, JSON.stringify(next));
      } catch {
        aui.composer.setText("This file could not be prepared in the browser. Please choose a smaller file.");
        return;
      }

      setAttachment(next);
      aui.composer.setText(`Please analyze the attached file: ${file.name}`);
      setComposerMenuOpen(false);
    };
    reader.readAsDataURL(file);
  };

  const clearAttachment = () => {
    localStorage.removeItem(PENDING_ATTACHMENT_KEY);
    setAttachment(null);
  };

  const prompt = (text:string) => aui.composer.setText(text);

  return (
    <main className={`nova-shell nova-command-center ${isEmpty ? "is-empty" : "has-chat"}`}>
      <div className={`nova-intro ${intro ? "is-visible" : "is-hidden"}`}><div className="intro-mark">N</div><div className="intro-name">NOVA</div></div>
      <NovaSideRail isEmpty={isEmpty} chats={chatHistory} onNew={createChat} onHistory={()=>setHistoryOpen(true)} onSettings={()=>{setSettingsOpen(true);setSettingsSection("General");}} onPrompt={prompt} />
      <section className="nova-main-column">
        <header className="topbar nova-command-topbar">
          <div className="topbar-title"><span className="topbar-nova-dot" /><strong>NOVA</strong><span>Your Personal AI System</span></div>
          <nav className="command-tabs">{[["Chat",""],["Create","Create something for me."],["Research","Research this deeply and verify the important claims."],["Analyze","Analyze this carefully and show the important findings."],["Build","Help me build this step by step."],["Plan","Help me plan this with dependencies and next steps."]].map(([label,value])=><button type="button" key={label} className={label==="Chat"?"selected":""} onClick={()=>value&&prompt(value)}>{label}</button>)}<button type="button" className="command-more" onClick={()=>setMenuOpen(o=>!o)}>More⌄</button></nav>
          <div className="topbar-actions"><button type="button" className="quiet-button" aria-label="Search">⌕</button><button type="button" className="quiet-button" aria-label="Notifications">♧</button><button type="button" className="top-avatar" onClick={()=>{setSettingsOpen(true);setSettingsSection("General");}}>S</button></div>
        </header>
        <div className="command-workspace">
          <AuiIf condition={state=>state.thread.isEmpty}><div className="hero-copy command-hero"><span className="eyebrow">INTELLIGENCE, CONNECTED</span><h1>What would you like<br />to accomplish today?</h1><p>Ask anything. Give NOVA a task. Let the system figure out what is required.</p></div></AuiIf>
          <ThreadPrimitive.Root className="thread">
            <ThreadPrimitive.Viewport className="thread-viewport" turnAnchor="top" scrollToBottomOnRunStart><ThreadPrimitive.Messages>{()=> <Message />}</ThreadPrimitive.Messages></ThreadPrimitive.Viewport>
            <ThreadPrimitive.ViewportFooter className="thread-footer">
              <ComposerPrimitive.Root className="composer command-composer">
                <ComposerPrimitive.Input className="composer-input" placeholder="Ask anything, or give NOVA a task..." submitOnEnter autoFocus />
                <div className="composer-footer">
                  <input ref={fileInputRef} className="nova-file-input" tabIndex={-1} aria-hidden="true" hidden type="file" accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/json" onChange={event=>{const file=event.target.files?.[0];if(file)handleAttachment(file);event.currentTarget.value="";}} />
                  <div className="composer-tools">
                    <div className="composer-menu-wrap"><button type="button" className={composerMenuOpen?"tool-button is-active":"tool-button"} aria-label="Open tools" aria-expanded={composerMenuOpen} onClick={()=>setComposerMenuOpen(o=>!o)}>＋</button>
                      {composerMenuOpen&&<div className="composer-menu" role="menu">
                        <button type="button" role="menuitem" onClick={chooseAttachment}><span className="composer-menu-icon">＋</span><span><strong>Add photos & files</strong><small>Images, PDFs and text files</small></span></button>
                        <button type="button" role="menuitem" onClick={()=>{prompt("Create an image for me.");setComposerMenuOpen(false);}}><span className="composer-menu-icon">✦</span><span><strong>Create image</strong></span></button>
                        <button type="button" role="menuitem" onClick={()=>{prompt("Do deep research on this.");setComposerMenuOpen(false);}}><span className="composer-menu-icon">◎</span><span><strong>Deep research</strong></span></button>
                        <button type="button" role="menuitem" onClick={()=>{prompt("Search the web for this.");setComposerMenuOpen(false);}}><span className="composer-menu-icon">⌕</span><span><strong>Web search</strong></span></button>
                      </div>}
                    </div>
                    <VoiceButton /><button type="button" className="composer-mode-pill" onClick={()=>prompt("Do deep research on this.")}>◉ Deep Research⌄</button>
                  </div>
                  <div className="composer-actions"><AuiIf condition={state=>state.thread.isRunning}><button type="button" className="stop-button" onClick={()=>aui.thread.cancelRun()} aria-label="Stop response">■</button></AuiIf><ComposerPrimitive.Send className="send-button" aria-label="Send message"><span>↑</span></ComposerPrimitive.Send></div>
                </div>
              </ComposerPrimitive.Root>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Root>
          {isEmpty&&<div className="command-capability-grid">{[["◉","Deep Research","Research anything with verified sources.","Research this topic deeply."],["✦","Create","Generate high-quality content and ideas.","Help me create this from scratch."],["▥","Analyze","Understand data and complex information.","Analyze this carefully."],["⌘","Build","Create apps, code and workflows.","Help me build this step by step."],["□","Plan","Turn goals into actionable plans.","Help me plan this."],["↻","Automate","Turn repeatable work into systems.","What could NOVA automate for me?"]].map(([icon,title,desc,value])=><button type="button" key={title} className="command-capability-card" onClick={()=>prompt(value)}><span className="capability-icon">{icon}</span><strong>{title}</strong><small>{desc}</small></button>)}</div>}
          {!isEmpty&&<section className="nova-current-task"><div className="task-head"><div><span className="task-kicker">CURRENT WORKSPACE</span><h2>{isRunning?"NOVA is working on your request":"Conversation workspace"}</h2></div><span className={isRunning?"task-status working":"task-status"}>{isRunning?"Working":"Ready"}</span></div><div className="task-progress"><span className={isRunning?"progress-fill working":"progress-fill"} /></div><div className="task-steps"><span className="done">✓ Understand</span><span className={isRunning?"active":"done"}>{isRunning?"● Execute":"✓ Plan"}</span><span>○ Verify</span><span>○ Complete</span></div></section>}
          {isRunning&&<div className="run-status"><span /> NOVA is working</div>}
        </div>
      </section>
      <NovaRightRail isRunning={isRunning} messageCount={messages.length} onPrompt={prompt} />
      <footer className="footer"><span>One intelligence layer.</span><span>Private by design.</span></footer>
      {historyOpen&&<ChatHistoryPanel chats={chatHistory} activeId={activeChat} search={historySearch} setSearch={setHistorySearch} onSelect={switchChat} onNew={createChat} onRename={renameChat} onDelete={deleteChat} onClose={()=>setHistoryOpen(false)} />}
      {settingsOpen&&<SettingsModal section={settingsSection} setSection={setSettingsSection} onClose={()=>setSettingsOpen(false)} />}
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
