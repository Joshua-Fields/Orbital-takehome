import { useCallback, useEffect, useMemo, useState } from "react";
import * as api from "../lib/api";
import type { Document } from "../types";

export function useDocument(conversationId: string | null) {
	const [documents, setDocuments] = useState<Document[]>([]);
	const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		if (!conversationId) {
			setDocuments([]);
			setSelectedDocumentId(null);
			return;
		}
		try {
			setError(null);
			const detail = await api.fetchConversation(conversationId);
			const nextDocuments = detail.documents ?? [];
			setDocuments(nextDocuments);
			setSelectedDocumentId((prev: string | null) => {
				if (prev && nextDocuments.some((doc) => doc.id === prev)) {
					return prev;
				}
				return nextDocuments[0]?.id ?? null;
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load document");
		}
	}, [conversationId]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const upload = useCallback(
		async (files: File[]) => {
			if (!conversationId || files.length === 0) return [];
			try {
				setUploading(true);
				setError(null);
				const uploadedDocuments = await api.uploadDocuments(conversationId, files);
				setDocuments((prev: Document[]) => {
					const merged = [...prev];
					for (const doc of uploadedDocuments) {
						if (!merged.some((existing) => existing.id === doc.id)) {
							merged.push(doc);
						}
					}
					return merged;
				});
				setSelectedDocumentId(
					(prev: string | null) => prev ?? uploadedDocuments[0]?.id ?? null,
				);
				return uploadedDocuments;
			} catch (err) {
				setError(
					err instanceof Error ? err.message : "Failed to upload documents",
				);
				return [];
			} finally {
				setUploading(false);
			}
		},
		[conversationId],
	);

	const document = useMemo(
		() =>
			documents.find((d: Document) => d.id === selectedDocumentId) ??
			documents[0] ??
			null,
		[documents, selectedDocumentId],
	);

	return {
		documents,
		document,
		selectedDocumentId,
		setSelectedDocumentId,
		hasDocuments: documents.length > 0,
		uploading,
		error,
		upload,
		refresh,
	};
}
