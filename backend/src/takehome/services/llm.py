# pyright: reportMissingImports=false, reportUnknownVariableType=false, reportUnknownMemberType=false, reportUnknownArgumentType=false, reportUnknownLambdaType=false, reportUnknownParameterType=false, reportUnnecessaryCast=false

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator, Sequence
from dataclasses import asdict, dataclass, field
from typing import Any, cast

from pydantic_ai import Agent  # pyright: ignore[reportMissingImports]

from takehome.config import settings  # noqa: F401 — triggers ANTHROPIC_API_KEY export
from takehome.db.models import Document

MODEL_NAME = "anthropic:claude-haiku-4-5-20251001"

_ = settings

answer_agent: Any = Agent(
    MODEL_NAME,
    system_prompt=(
        "You are a helpful legal document assistant for commercial real estate lawyers. "
        "You help lawyers review and understand documents during due diligence.\n\n"
        "CRITICAL RULES (NO EXCEPTIONS):\n"
        "- Only answer using the uploaded document content provided in the prompt. Do NOT use outside knowledge or guess.\n"
        '- If the documents do not clearly contain the answer, say "I don\'t know based on the documents" and briefly explain what is missing.\n'
        "- Every factual statement must be followed by an inline citation using the exact format (Doc N, Page X) or (Doc N, Page X, Section Y) or (Doc N, Page X, Clause Y).\n"
        "- Use the document labels exactly as provided. Never cite a document label or page that is not present in the prompt.\n"
        "- Never invent clauses, parties, dates, numbers, or citations. If you are unsure, omit the claim.\n"
        "- Be concise and precise. Lawyers value accuracy over verbosity."
    ),
)

answerability_agent: Any = Agent(
    MODEL_NAME,
    system_prompt=(
        "You are a strict answerability classifier for grounded legal document QA.\n"
        "Decide whether the user's question can be answered solely from the uploaded documents.\n"
        "A question is answerable only if the documents contain enough support for a grounded answer with at least one document/page citation.\n"
        "Return JSON only with the keys answerable, reason, and missing_information.\n"
        "Do not include markdown fences or extra commentary."
    ),
)

title_agent: Any = Agent(
    MODEL_NAME,
    system_prompt=(
        "Generate concise conversation titles. Return only the title text with no quotes or commentary."
    ),
)

INLINE_CITATION_PATTERN = re.compile(
    r"\((?P<document_label>Doc\s+(?P<document_number>\d+))\s*,\s*Page\s+"
    r"(?P<page>\d+)(?:\s*,\s*(?:(?P<section_type>Section|Clause|Paragraph)\s+)?"
    r"(?P<section_value>[^)]+?))?\)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class DocumentReference:
    document_id: str
    document_label: str
    filename: str
    page_count: int


@dataclass(frozen=True)
class DocumentPromptContext:
    prompt_text: str | None
    documents_by_label: dict[str, DocumentReference]


@dataclass(frozen=True)
class AnswerabilityAssessment:
    answerable: bool
    reason: str | None = None
    missing_information: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Citation:
    document_id: str
    document_label: str
    document_filename: str
    page: int
    section_or_clause: str | None
    display_text: str
    valid: bool

    def asdict(self) -> dict[str, Any]:
        return asdict(self)


def build_document_context(documents: Sequence[Document]) -> DocumentPromptContext:
    """Build a prompt block with stable document labels for citations."""
    if not documents:
        return DocumentPromptContext(prompt_text=None, documents_by_label={})

    document_blocks: list[str] = []
    documents_by_label: dict[str, DocumentReference] = {}

    for index, document in enumerate(documents, start=1):
        label = f"Doc {index}"
        document_id = str(document.id)
        filename = str(document.filename)
        page_count = int(document.page_count)
        raw_extracted_text = document.extracted_text
        documents_by_label[label] = DocumentReference(
            document_id=document_id,
            document_label=label,
            filename=filename,
            page_count=page_count,
        )
        extracted_text = (
            raw_extracted_text.strip()
            if isinstance(raw_extracted_text, str) and raw_extracted_text.strip()
            else "[No extractable text was found in this PDF.]"
        )
        document_blocks.append(
            f'<document label="{label}" filename="{filename}" document_id="{document_id}">\n'
            f"{extracted_text}\n"
            "</document>"
        )

    prompt_text = (
        "The following uploaded documents are available. "
        "Use the provided document labels exactly when citing.\n\n"
        "<documents>\n"
        + "\n\n".join(document_blocks)
        + "\n</documents>\n"
    )
    return DocumentPromptContext(
        prompt_text=prompt_text,
        documents_by_label=documents_by_label,
    )


def _build_shared_prompt(
    user_message: str,
    document_context: DocumentPromptContext,
    conversation_history: list[dict[str, str]],
) -> str:
    prompt_parts: list[str] = []

    if document_context.prompt_text:
        prompt_parts.append(document_context.prompt_text)
    else:
        prompt_parts.append(
            "No document has been uploaded yet. If the user asks about a document, "
            "tell them they need to upload one first.\n"
        )

    if conversation_history:
        prompt_parts.append("Previous conversation:\n")
        for message in conversation_history:
            role = message["role"]
            content = message["content"]
            if role == "user":
                prompt_parts.append(f"User: {content}\n")
            elif role == "assistant":
                prompt_parts.append(f"Assistant: {content}\n")
        prompt_parts.append("\n")

    prompt_parts.append(f"User: {user_message}")
    return "\n".join(prompt_parts)


def _strip_json_fence(raw_output: str) -> str:
    raw_output = raw_output.strip()
    if raw_output.startswith("```"):
        lines = raw_output.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        raw_output = "\n".join(lines).strip()
    return raw_output


async def assess_answerability(
    user_message: str,
    document_context: DocumentPromptContext,
    conversation_history: list[dict[str, str]],
) -> AnswerabilityAssessment:
    """Decide whether the question is answerable from uploaded documents."""
    if document_context.prompt_text is None:
        return AnswerabilityAssessment(
            answerable=False,
            reason="No document has been uploaded yet.",
            missing_information=["Upload the relevant document before asking this question."],
        )

    prompt = (
        _build_shared_prompt(user_message, document_context, conversation_history)
        + "\n\nDecide whether the user's last question can be answered from the uploaded documents alone.\n"
        + "Return JSON only in this shape:\n"
        + '{"answerable": true, "reason": "short explanation", "missing_information": ["item 1"]}'
    )

    result: Any = await answerability_agent.run(prompt)
    raw_output = _strip_json_fence(str(result.output))

    try:
        parsed = json.loads(raw_output)
    except json.JSONDecodeError:
        normalized = raw_output.lower()
        return AnswerabilityAssessment(
            answerable=normalized.startswith("yes"),
            reason="The answerability classifier returned an unstructured response.",
            missing_information=[],
        )

    answerable = bool(parsed.get("answerable"))
    reason = str(parsed.get("reason")).strip() if parsed.get("reason") else None
    missing_information_raw: Any = parsed.get("missing_information") or []
    if isinstance(missing_information_raw, list):
        missing_information = [str(item).strip() for item in missing_information_raw if str(item).strip()]
    else:
        missing_information = [str(missing_information_raw).strip()]

    return AnswerabilityAssessment(
        answerable=answerable,
        reason=reason,
        missing_information=missing_information,
    )


def build_unanswerable_response(assessment: AnswerabilityAssessment) -> str:
    """Return a consistent fallback when the documents cannot support an answer."""
    response_lines = [
        "I don't have enough information in the uploaded documents to answer this reliably.",
    ]

    if assessment.reason:
        response_lines.append("")
        response_lines.append(f"Why: {assessment.reason}")

    if assessment.missing_information:
        response_lines.append("")
        response_lines.append("What I would need:")
        response_lines.extend(f"- {item}" for item in assessment.missing_information)
    else:
        response_lines.append("")
        response_lines.append(
            "What I would need:\n- The relevant document, clause, or page that addresses this question."
        )

    return "\n".join(response_lines)


async def generate_title(user_message: str) -> str:
    """Generate a 3-5 word conversation title from the first user message."""
    result: Any = await title_agent.run(
        f"Generate a concise 3-5 word title for a conversation that starts with: '{user_message}'. "
        "Return only the title, nothing else."
    )
    title = str(result.output).strip().strip('"').strip("'")
    if len(title) > 100:
        title = title[:97] + "..."
    return title


async def chat_with_document(
    user_message: str,
    document_context: DocumentPromptContext,
    conversation_history: list[dict[str, str]],
) -> AsyncIterator[str]:
    """Stream a grounded response with inline citations."""
    full_prompt = _build_shared_prompt(user_message, document_context, conversation_history)
    async with answer_agent.run_stream(full_prompt) as stream_result:
        result = cast(Any, stream_result)
        async for text in result.stream_text(delta=True):
            yield str(text)


def extract_citations(
    response: str,
    document_context: DocumentPromptContext,
) -> list[Citation]:
    """Extract and validate inline citations from a model response."""
    citations: list[Citation] = []
    seen: set[tuple[str, int, str | None]] = set()

    for match in INLINE_CITATION_PATTERN.finditer(response):
        document_label = f"Doc {int(match.group('document_number'))}"
        page = int(match.group("page"))
        section_type = match.group("section_type")
        section_value = match.group("section_value")
        if section_value:
            normalized_value = section_value.strip()
            section_or_clause = (
                f"{section_type.title()} {normalized_value}"
                if section_type
                else normalized_value
            )
        else:
            section_or_clause = None
        document_reference = document_context.documents_by_label.get(document_label)
        document_id = document_reference.document_id if document_reference else ""
        dedupe_key = (document_id or document_label, page, section_or_clause)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        valid = bool(
            document_reference and 1 <= page <= max(document_reference.page_count, 1)
        )

        citations.append(
            Citation(
                document_id=document_reference.document_id if document_reference else "",
                document_label=document_label,
                document_filename=document_reference.filename if document_reference else "",
                page=page,
                section_or_clause=section_or_clause,
                display_text=match.group(0),
                valid=valid,
            )
        )

    return citations


def get_citation_status(citations: Sequence[Citation]) -> str:
    """Summarize how trustworthy the extracted citations are."""
    if not citations:
        return "failed"
    valid_count = sum(1 for citation in citations if citation.valid)
    if valid_count == len(citations):
        return "verified"
    if valid_count > 0:
        return "partial"
    return "failed"


def get_confidence(
    answerable: bool,
    citation_status: str,
    citations: Sequence[Citation],
) -> str:
    """Derive a simple user-facing confidence tier."""
    if not answerable:
        return "low"
    if citation_status == "failed":
        return "low"
    if citation_status == "verified" and citations and all(
        citation.section_or_clause for citation in citations
    ):
        return "high"
    return "medium"
