import { useCallback, useEffect, useState } from "react";
import { ChatSidebar } from "./components/ChatSidebar";
import { ChatWindow } from "./components/ChatWindow";
import { DocumentViewer } from "./components/DocumentViewer";
import { Threads } from "./components/Threads/Threads";
import { TooltipProvider } from "./components/ui/tooltip";
import { useConversations } from "./hooks/use-conversations";
import { useDocument } from "./hooks/use-document";
import { useMessages } from "./hooks/use-messages";
import type { Citation } from "./types";

export default function App() {
  const {
    conversations,
    selectedId,
    loading: conversationsLoading,
    create,
    select,
    remove,
    refresh: refreshConversations,
  } = useConversations();

  const {
    messages,
    loading: messagesLoading,
    error: messagesError,
    streaming,
    streamingContent,
    send,
  } = useMessages(selectedId);

  const {
    documents,
    selectedDocumentId,
    setSelectedDocumentId,
    hasDocuments,
    uploading,
    upload,
    refresh: refreshDocument,
  } = useDocument(selectedId);
  const [currentPage, setCurrentPage] = useState(1);
  const [activeCitationLabel, setActiveCitationLabel] = useState<string | null>(null);

  useEffect(() => {
    setCurrentPage(1);
    setActiveCitationLabel(null);
  }, [selectedId]);

  const handleSend = useCallback(
    async (content: string) => {
      await send(content);
      refreshConversations();
    },
    [send, refreshConversations],
  );

  const handleUpload = useCallback(
    async (files: File[]) => {
      const uploaded = await upload(files);
      if (uploaded.length > 0) {
        refreshDocument();
        refreshConversations();
      }
    },
    [upload, refreshDocument, refreshConversations],
  );

  const handleCreate = useCallback(async () => {
    await create();
  }, [create]);

  const handleSelectDocument = useCallback(
    (documentId: string) => {
      setSelectedDocumentId(documentId);
      setCurrentPage(1);
      setActiveCitationLabel(null);
    },
    [setSelectedDocumentId],
  );

  const handleCitationClick = useCallback(
    (citation: Citation) => {
      if (citation.document_id) {
        setSelectedDocumentId(citation.document_id);
      }
      setCurrentPage(Math.max(1, citation.page));
      setActiveCitationLabel(citation.section_or_clause ?? citation.display_text);
    },
    [setSelectedDocumentId],
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative flex h-screen w-full flex-col">
        {/* Full-viewport Threads background */}
        <div className="fixed inset-0 z-0">
          <Threads
            color={[0, 0, 0]}
            amplitude={1}
            distance={0}
            enableMouseInteraction
          />
        </div>
        {/* Three columns above the background */}
        <div className="relative z-10 flex h-full w-full flex-1">
          <ChatSidebar
          conversations={conversations}
          selectedId={selectedId}
          loading={conversationsLoading}
          onSelect={select}
          onCreate={handleCreate}
          onDelete={remove}
        />

        <ChatWindow
          messages={messages}
          loading={messagesLoading}
          error={messagesError}
          streaming={streaming}
          streamingContent={streamingContent}
          uploading={uploading}
          hasDocument={hasDocuments}
          conversationId={selectedId}
          onSend={handleSend}
          onUpload={handleUpload}
          onCitationClick={handleCitationClick}
        />

          <DocumentViewer
            documents={documents}
            selectedDocumentId={selectedDocumentId}
            onSelectDocument={handleSelectDocument}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            activeCitationLabel={activeCitationLabel}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
