import type { Message } from "../types";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const PAGE_MARGIN = 54;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;
const MAX_CHARS_PER_LINE = 88;

function sanitizePdfText(value: string): string {
	return value
		.replace(/[^\x20-\x7E\n]/g, (char) => {
			switch (char) {
				case "’":
				case "‘":
					return "'";
				case "“":
				case "”":
					return '"';
				case "–":
				case "—":
					return "-";
				default:
					return "?";
			}
		})
		.replace(/\\/g, "\\\\")
		.replace(/\(/g, "\\(")
		.replace(/\)/g, "\\)");
}

function wrapLine(line: string, maxChars = MAX_CHARS_PER_LINE): string[] {
	if (!line.trim()) return [""];

	const words = line.split(/\s+/);
	const wrapped: string[] = [];
	let current = "";

	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (next.length <= maxChars) {
			current = next;
			continue;
		}

		if (current) {
			wrapped.push(current);
			current = word;
			continue;
		}

		for (let index = 0; index < word.length; index += maxChars) {
			wrapped.push(word.slice(index, index + maxChars));
		}
		current = "";
	}

	if (current) {
		wrapped.push(current);
	}

	return wrapped;
}

function buildExportText(message: Message): string {
	const sections = [
		"Orbital Assistant Answer",
		`Created: ${new Date(message.created_at).toLocaleString()}`,
	];

	if (message.confidence) {
		sections.push(`Confidence: ${message.confidence}`);
	}

	if (message.answerability_reason) {
		sections.push(`Notes: ${message.answerability_reason}`);
	}

	sections.push("", "Answer:", message.content.trim() || "[No content]");

	if (message.citations?.length) {
		sections.push("", "Citations:");
		for (const citation of message.citations) {
			const section = citation.section_or_clause
				? `, ${citation.section_or_clause}`
				: "";
			sections.push(
				`- ${citation.document_label}, Page ${citation.page}${section} (${citation.document_filename})`,
			);
		}
	}

	return sections.join("\n");
}

function paginateText(text: string): string[][] {
	const maxLinesPerPage = Math.floor(
		(PAGE_HEIGHT - PAGE_MARGIN * 2) / LINE_HEIGHT,
	);
	const lines = text.split("\n").flatMap((line) => wrapLine(line));
	const pages: string[][] = [];

	for (let index = 0; index < lines.length; index += maxLinesPerPage) {
		pages.push(lines.slice(index, index + maxLinesPerPage));
	}

	return pages.length > 0 ? pages : [[""]];
}

function buildContentStream(lines: string[]): string {
	const startY = PAGE_HEIGHT - PAGE_MARGIN - FONT_SIZE;
	const chunks = [
		"BT",
		"/F1 11 Tf",
		`${LINE_HEIGHT} TL`,
		`1 0 0 1 ${PAGE_MARGIN} ${startY} Tm`,
	];

	lines.forEach((line, index) => {
		const operator = index === 0 ? "Tj" : "'"; // move down and show text
		chunks.push(`(${sanitizePdfText(line)}) ${operator}`);
	});

	chunks.push("ET");
	return chunks.join("\n");
}

function createPdfBlob(text: string): Blob {
	const pages = paginateText(text);
	const objects: string[] = [];

	objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";

	const fontObjectNumber = 3;
	const firstPageObjectNumber = 4;
	const pageRefs = pages.map((_, index) => `${firstPageObjectNumber + index * 2} 0 R`);
	objects[2] = `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pages.length} >>`;
	objects[fontObjectNumber] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

	pages.forEach((pageLines, index) => {
		const pageObjectNumber = firstPageObjectNumber + index * 2;
		const contentObjectNumber = pageObjectNumber + 1;
		const contentStream = buildContentStream(pageLines);
		objects[pageObjectNumber] =
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
			`/Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`;
		objects[contentObjectNumber] =
			`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`;
	});

	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [0];

	for (let index = 1; index < objects.length; index += 1) {
		if (!objects[index]) continue;
		offsets[index] = pdf.length;
		pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
	}

	const xrefOffset = pdf.length;
	pdf += `xref\n0 ${objects.length}\n`;
	pdf += "0000000000 65535 f \n";

	for (let index = 1; index < objects.length; index += 1) {
		const offset = offsets[index] ?? 0;
		pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
	}

	pdf +=
		`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

	return new Blob([pdf], { type: "application/pdf" });
}

function buildFileName(message: Message): string {
	const timestamp = new Date(message.created_at)
		.toISOString()
		.replace(/[:.]/g, "-");
	return `assistant-answer-${timestamp}.pdf`;
}

export function downloadAssistantMessagePdf(message: Message) {
	const blob = createPdfBlob(buildExportText(message));
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = buildFileName(message);
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	URL.revokeObjectURL(url);
}
