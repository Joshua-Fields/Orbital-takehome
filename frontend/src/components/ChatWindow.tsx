import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Citation, Message } from "../types";
import { ChatInput } from "./ChatInput";
import { EmptyState } from "./EmptyState";
import { MessageBubble, StreamingBubble } from "./MessageBubble";

interface ChatWindowProps {
  messages: Message[];
  loading: boolean;
  error: string | null;
  streaming: boolean;
  streamingContent: string;
  uploading: boolean;
  hasDocument: boolean;
  conversationId: string | null;
  onSend: (content: string) => void;
  onUpload: (files: File[]) => void;
  onCitationClick: (citation: Citation) => void;
}

export function ChatWindow({
  messages,
  loading,
  error,
  streaming,
  streamingContent,
  uploading,
  hasDocument,
  conversationId,
  onSend,
  onUpload,
  onCitationClick,
}: ChatWindowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive or during streaming
  const messagesLength = messages.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages and streamingContent are intentional triggers for auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messagesLength, streamingContent]);

  // No conversation selected
  if (!conversationId) {
    return (
      <div className="flex flex-1 items-center justify-center bg-transparent">
        <div className="rounded-full border border-white/20 bg-white/10 px-6 py-3 backdrop-blur-md">
          <p className="text-base font-semibold text-neutral-700">
            Select a conversation or create a new one
          </p>
        </div>
      </div>
    );
  }

  // Loading messages
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-transparent">
        <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  // Empty conversation - show upload prompt
  if (messages.length === 0 && !streaming) {
    return (
      <div className="flex flex-1 flex-col bg-transparent">
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            onUpload={onUpload}
            uploading={uploading}
            hasDocument={hasDocument}
          />
        </div>
        <ChatInput
          onSend={onSend}
          onUpload={onUpload}
          disabled={streaming}
          hasDocument={hasDocument}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-transparent">
      {error && (
        <div className="mx-4 mt-2 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-2xl space-y-1">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onCitationClick={onCitationClick}
            />
          ))}
          {streaming && <StreamingBubble content={streamingContent} />}
        </div>
      </div>

      <ChatInput
        onSend={onSend}
        onUpload={onUpload}
        disabled={streaming}
        hasDocument={hasDocument}
      />
    </div>
  );
}
