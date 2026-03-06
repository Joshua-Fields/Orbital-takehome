import { motion } from "framer-motion";
import { Bot, Check, Copy, FileDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { downloadAssistantMessagePdf } from "../lib/export-message";
import type { Citation, Message } from "../types";
import { Button } from "./ui/button";

interface MessageBubbleProps {
	message: Message;
	onCitationClick: (citation: Citation) => void;
}

function getConfidenceBadgeClasses(confidence: Message["confidence"]) {
	switch (confidence) {
		case "high":
			return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700";
		case "medium":
			return "border-amber-500/30 bg-amber-500/10 text-amber-700";
		case "low":
			return "border-red-500/30 bg-red-500/10 text-red-700";
		default:
			return "border-white/20 bg-white/10 text-neutral-700";
	}
}

function renderCitationLabel(citation: Citation) {
	return citation.section_or_clause
		? `${citation.document_label} • Page ${citation.page} • ${citation.section_or_clause}`
		: `${citation.document_label} • Page ${citation.page}`;
}

export function MessageBubble({ message, onCitationClick }: MessageBubbleProps) {
	const confidenceLabel = message.confidence
		? `${message.confidence.charAt(0).toUpperCase()}${message.confidence.slice(1)} confidence`
		: null;
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timeout = window.setTimeout(() => setCopied(false), 1500);
		return () => window.clearTimeout(timeout);
	}, [copied]);

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(message.content);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	if (message.role === "system") {
		return (
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 0.2 }}
				className="flex justify-center py-2"
			>
				<p className="text-xs text-neutral-400">{message.content}</p>
			</motion.div>
		);
	}

	if (message.role === "user") {
		return (
			<motion.div
				initial={{ opacity: 0, y: 8 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.2 }}
				className="flex justify-end py-1.5"
			>
				<div className="max-w-[75%] rounded-2xl rounded-br-md bg-neutral-100 px-4 py-2.5">
					<p className="whitespace-pre-wrap text-sm text-neutral-800">
						{message.content}
					</p>
				</div>
			</motion.div>
		);
	}

	// Assistant message
	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2 }}
			className="flex gap-3 py-1.5"
		>
			<div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900">
				<Bot className="h-4 w-4 text-white" />
			</div>
			<div className="min-w-0 max-w-[80%]">
				<div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 backdrop-blur-md">
					<div className="mb-2 flex flex-wrap items-start justify-between gap-2">
						<div className="flex flex-wrap items-center gap-2">
							{message.confidence && (
								<span
									className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getConfidenceBadgeClasses(message.confidence)}`}
								>
									{confidenceLabel}
								</span>
							)}
							{message.citation_status === "failed" && (
								<span className="text-xs font-medium text-red-600">
									Citations missing or unverified
								</span>
							)}
						</div>
						<div className="flex items-center gap-1">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-7 w-7 rounded-full bg-white/10 text-neutral-800 hover:bg-white/30"
								onClick={handleCopy}
								title={copied ? "Copied" : "Copy answer"}
							>
								{copied ? (
									<Check className="h-3.5 w-3.5" />
								) : (
									<Copy className="h-3.5 w-3.5" />
								)}
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-7 w-7 rounded-full bg-white/10 text-neutral-800 hover:bg-white/30"
								onClick={() => downloadAssistantMessagePdf(message)}
								title="Download as PDF"
							>
								<FileDown className="h-3.5 w-3.5" />
							</Button>
						</div>
					</div>
					<div className="prose text-neutral-900">
						<Streamdown>{message.content}</Streamdown>
					</div>
					{message.answerability_reason && message.confidence === "low" && (
						<p className="mt-3 text-xs text-neutral-600">
							{message.answerability_reason}
						</p>
					)}
					{message.citations && message.citations.length > 0 && (
						<div className="mt-3 flex flex-wrap gap-2">
							{message.citations.map((citation) => (
								<button
									key={`${citation.document_id}-${citation.page}-${citation.section_or_clause ?? "page"}`}
									type="button"
									className="rounded-full border border-white/20 bg-white/20 px-2.5 py-1 text-xs font-medium text-neutral-800 transition-colors hover:bg-white/35"
									onClick={() => onCitationClick(citation)}
									title={citation.document_filename}
								>
									{renderCitationLabel(citation)}
								</button>
							))}
						</div>
					)}
				</div>
				{message.sources_cited > 0 && (
					<p className="mt-1.5 text-xs text-neutral-400">
						{message.sources_cited} source
						{message.sources_cited !== 1 ? "s" : ""} cited
					</p>
				)}
			</div>
		</motion.div>
	);
}

interface StreamingBubbleProps {
	content: string;
}

export function StreamingBubble({ content }: StreamingBubbleProps) {
	return (
		<div className="flex gap-3 py-1.5">
			<div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900">
				<Bot className="h-4 w-4 text-white" />
			</div>
			<div className="min-w-0 max-w-[80%]">
				<div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-2.5 backdrop-blur-md">
					{content ? (
						<div className="prose text-neutral-900">
							<Streamdown mode="streaming">{content}</Streamdown>
						</div>
					) : (
						<div className="flex items-center gap-1 py-2">
							<span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400" />
							<span
								className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400"
								style={{ animationDelay: "0.15s" }}
							/>
							<span
								className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400"
								style={{ animationDelay: "0.3s" }}
							/>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
