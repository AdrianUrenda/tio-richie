interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
}

export default function ChatMessage({ role, content }: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[70%] ${
          isUser
            ? "bg-green-600 text-white"
            : "bg-green-100 text-gray-800"
        }`}
      >
        {!isUser && (
          <p className="mb-1 text-xs font-semibold text-green-700">
            Tío Richie
          </p>
        )}
        <p>{content}</p>
      </div>
    </div>
  );
}
