export interface Conversation {
	id: string;
	title: string;
	created_at: string;
	updated_at: string;
	has_document: boolean;
}

export interface Message {
	id: string;
	conversation_id: string;
	role: "user" | "assistant" | "system";
	content: string;
	sources_cited: number;
	answerable?: boolean | null;
	confidence?: "low" | "medium" | "high" | null;
	citation_status?: "verified" | "partial" | "failed" | "not_applicable" | null;
	answerability_reason?: string | null;
	citations?: Citation[];
	created_at: string;
}

export interface Citation {
	document_id: string;
	document_label: string;
	document_filename: string;
	page: number;
	section_or_clause: string | null;
	display_text: string;
	valid: boolean;
}

export interface Document {
	id: string;
	conversation_id: string;
	filename: string;
	page_count: number;
	uploaded_at: string;
}

export interface ConversationDetail extends Conversation {
	documents: Document[];
}
