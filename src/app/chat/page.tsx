"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import ChatMessage from "@/components/ChatMessage";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface SafeToSpend {
  amount: number | null;
  label: string;
  hasFinancialData: boolean;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("accessToken");
}

export default function ChatPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [safeToSpend, setSafeToSpend] = useState<SafeToSpend | null>(null);
  const [initialized, setInitialized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Load conversation history and safe-to-spend on mount
  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    // Fetch both in parallel
    Promise.all([
      fetch("/api/chat/history", { headers }),
      fetch("/api/chat/safe-to-spend", { headers }),
    ])
      .then(async ([historyRes, safeRes]) => {
        if (historyRes.status === 401 || safeRes.status === 401) {
          router.push("/login");
          return;
        }

        if (historyRes.ok) {
          const data = await historyRes.json();
          setConversationId(data.conversationId);

          if (data.messages && data.messages.length > 0) {
            setMessages(
              data.messages.map(
                (m: { role: string; content: string }, i: number) => ({
                  id: `hist-${i}`,
                  role: m.role as "user" | "assistant",
                  content: m.content,
                }),
              ),
            );
          } else {
            // Show welcome message for new conversations
            setMessages([
              {
                id: "welcome",
                role: "assistant",
                content:
                  "¡Hola! Soy Tío Richie, tu coach de finanzas personales. Estoy aquí para ayudarte a entender y mejorar tus hábitos financieros. ¿En qué puedo ayudarte hoy?",
              },
            ]);
          }
        }

        if (safeRes.ok) {
          const safeData = await safeRes.json();
          setSafeToSpend(safeData);
        }
      })
      .catch(() => {
        setMessages([
          {
            id: "error",
            role: "assistant",
            content:
              "Tuve un problema al cargar tu historial. Intenta recargar la página.",
          },
        ]);
      })
      .finally(() => {
        setInitialized(true);
      });
  }, [router]);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    const token = getToken();
    if (!token) {
      router.push("/login");
      return;
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    inputRef.current?.focus();

    // Create streaming assistant message placeholder
    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", isStreaming: true },
    ]);

    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmed,
          conversationId,
        }),
      });

      if (response.status === 401) {
        router.push("/login");
        return;
      }

      if (!response.ok || !response.body) {
        throw new Error("Respuesta inválida del servidor");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === "delta") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: m.content + event.text }
                    : m,
                ),
              );
            } else if (event.type === "done") {
              if (event.conversationId) {
                setConversationId(event.conversationId);
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, isStreaming: false }
                    : m,
                ),
              );
            } else if (event.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: event.error, isStreaming: false }
                    : m,
                ),
              );
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content:
                  "Lo siento, tuve un problema de conexión. ¿Puedes intentar de nuevo?",
                isStreaming: false,
              }
            : m,
        ),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!initialized) {
    return (
      <div className="flex h-dvh items-center justify-center bg-white">
        <div className="text-sm text-gray-400">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-white">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        <a
          href="/"
          className="text-green-600 hover:text-green-700"
          aria-label="Volver al inicio"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="h-5 w-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 19.5 8.25 12l7.5-7.5"
            />
          </svg>
        </a>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900">Tío Richie</h1>
          <p className="text-xs text-gray-500">Tu coach financiero</p>
        </div>
      </header>

      {/* Safe to spend banner */}
      {safeToSpend && (
        <div
          className={`border-b px-4 py-2.5 text-center text-sm font-medium ${
            safeToSpend.hasFinancialData
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-amber-200 bg-amber-50 text-amber-800"
          }`}
        >
          {safeToSpend.hasFinancialData ? (
            <>
              Hoy puedes gastar:{" "}
              <span className="font-bold">
                ${safeToSpend.amount?.toLocaleString("es-MX")} MXN
              </span>
            </>
          ) : (
            <span>{safeToSpend.label}</span>
          )}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              isStreaming={message.isStreaming}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu mensaje..."
            disabled={isLoading}
            className="flex-1 rounded-full border border-gray-300 px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-gray-400 focus:border-green-500 focus:ring-2 focus:ring-green-500/20 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="rounded-full bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-50 disabled:hover:bg-green-600"
            aria-label="Enviar mensaje"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
