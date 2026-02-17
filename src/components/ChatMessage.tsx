interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

export default function ChatMessage({
  role,
  content,
  isStreaming,
}: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[70%] ${
          isUser ? "bg-green-600 text-white" : "bg-green-100 text-gray-800"
        }`}
      >
        {!isUser && (
          <p className="mb-1 text-xs font-semibold text-green-700">
            Tío Richie
          </p>
        )}
        {content ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : isStreaming ? (
          <span className="inline-flex gap-1 text-gray-400">
            <span className="animate-bounce" style={{ animationDelay: "0ms" }}>
              .
            </span>
            <span
              className="animate-bounce"
              style={{ animationDelay: "150ms" }}
            >
              .
            </span>
            <span
              className="animate-bounce"
              style={{ animationDelay: "300ms" }}
            >
              .
            </span>
          </span>
        ) : null}
        {isStreaming && content && (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-green-700" />
        )}
      </div>
    </div>
  );
}
