"use client";

import { useEffect, useRef, useState, FormEvent } from "react";
import { apiFetch, apiStream, SSEEvent } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface SafeToSpend {
  safeToSpend: number;
  currency: string;
  remainingDays: number;
  periodEnd: string;
  hasData: boolean;
}

const QUICK_ACTIONS = [
  { label: "¿Cuánto puedo gastar?", message: "¿Cuánto puedo gastar hoy?" },
  { label: "Mi deuda", message: "¿Cómo va mi deuda?" },
  { label: "Mis metas", message: "¿Cómo van mis metas financieras?" },
  { label: "Resumen del mes", message: "Dame un resumen de mis finanzas este mes" },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [safeToSpend, setSafeToSpend] = useState<SafeToSpend | null>(null);
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  // Auth guard + load conversation + safe-to-spend
  useEffect(() => {
    if (!token) {
      window.location.href = "/login";
      return;
    }

    Promise.all([
      apiFetch<{ conversation: { id: string; messages: Message[] } }>("/api/chat/conversations", { token }),
      apiFetch<SafeToSpend>("/api/finance/safe-to-spend", { token }).catch(() => null),
    ])
      .then(([convoData, stsData]) => {
        setConversationId(convoData.conversation.id);
        setMessages(convoData.conversation.messages);
        if (stsData) setSafeToSpend(stsData);
      })
      .catch(() => {
        localStorage.removeItem("token");
        window.location.href = "/login";
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text: string) {
    if (!text.trim() || streaming || !token) return;

    const userMsg: Message = { role: "user", content: text.trim(), timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    // Add placeholder for streaming assistant response
    const assistantMsg: Message = { role: "assistant", content: "", timestamp: new Date().toISOString() };
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      await apiStream(
        "/api/chat/message",
        { conversationId, message: text.trim() },
        token,
        (event: SSEEvent) => {
          if (event.type === "text" && event.content) {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === "assistant") {
                updated[updated.length - 1] = { ...last, content: last.content + event.content };
              }
              return updated;
            });
          } else if (event.type === "done" && event.conversationId) {
            setConversationId(event.conversationId);
          } else if (event.type === "error") {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === "assistant" && last.content === "") {
                updated[updated.length - 1] = {
                  ...last,
                  content: "Lo siento, hubo un error. Intenta de nuevo.",
                };
              }
              return updated;
            });
          }
        },
      );
    } catch {
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === "assistant" && last.content === "") {
          updated[updated.length - 1] = {
            ...last,
            content: "No se pudo conectar con el servidor. Verifica tu conexión.",
          };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-gray-50">
        <p className="text-gray-400">Cargando...</p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-gray-50">
      {/* Header with safe-to-spend */}
      <header className="flex-none border-b bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Tío Richie</h1>
            <p className="text-xs text-gray-400">Tu coach financiero</p>
          </div>
          <div className="text-right">
            {safeToSpend && safeToSpend.hasData ? (
              <>
                <p className="text-xs text-gray-400">Puedes gastar hoy</p>
                <p className="text-lg font-bold text-emerald-600">
                  ${safeToSpend.safeToSpend.toLocaleString("es-MX")} <span className="text-xs font-normal text-gray-400">MXN</span>
                </p>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-400">Puedes gastar hoy</p>
                <p className="text-sm text-gray-300">Conecta tu banco</p>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <p className="mb-1 text-xl font-semibold text-gray-700">
                ¡Hola, sobrino! 👋
              </p>
              <p className="mb-6 text-sm text-gray-400">
                Soy Tío Richie, tu coach de finanzas. ¿En qué te puedo ayudar?
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendMessage(action.message)}
                    disabled={streaming}
                    className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 shadow-sm transition hover:border-blue-300 hover:text-blue-600 disabled:opacity-50"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "rounded-br-md bg-blue-600 text-white"
                    : "rounded-bl-md bg-white text-gray-800 shadow-sm"
                }`}
              >
                <MessageContent content={msg.content} isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"} />
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Quick actions (shown when there are messages) */}
      {messages.length > 0 && !streaming && (
        <div className="flex-none border-t bg-gray-50 px-4 py-2">
          <div className="mx-auto flex max-w-2xl gap-2 overflow-x-auto">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => sendMessage(action.message)}
                className="flex-none rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-500 transition hover:border-blue-300 hover:text-blue-600"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <footer className="flex-none border-t bg-white px-4 py-3">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu mensaje..."
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={streaming || !input.trim()}
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-blue-600 text-white transition hover:bg-blue-700 disabled:opacity-30"
            aria-label="Enviar mensaje"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95l14.095-5.638a.75.75 0 0 0 0-1.392L3.105 2.288Z" />
            </svg>
          </button>
        </form>
      </footer>
    </div>
  );
}

function MessageContent({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  if (!content && isStreaming) {
    return (
      <span className="inline-flex items-center gap-1 text-gray-400">
        <span className="animate-pulse">●</span>
        <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
        <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
      </span>
    );
  }

  // Render paragraphs with basic formatting
  const paragraphs = content.split("\n\n").filter(Boolean);
  return (
    <>
      {paragraphs.map((p, i) => {
        const lines = p.split("\n");
        return (
          <p key={i} className={i > 0 ? "mt-2" : ""}>
            {lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {line}
              </span>
            ))}
          </p>
        );
      })}
      {isStreaming && <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current" />}
    </>
  );
}
