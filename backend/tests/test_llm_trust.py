from __future__ import annotations

from takehome.db.models import Document
from takehome.services.llm import (
    AnswerabilityAssessment,
    build_document_context,
    build_unanswerable_response,
    extract_citations,
    get_citation_status,
    get_confidence,
)


def make_document(
    document_id: str,
    filename: str,
    page_count: int,
    extracted_text: str,
) -> Document:
    return Document(
        id=document_id,
        conversation_id="conversation-1",
        filename=filename,
        file_path=f"/tmp/{filename}",
        extracted_text=extracted_text,
        page_count=page_count,
    )


def test_extract_citations_supports_multi_document_answers() -> None:
    context = build_document_context(
        [
            make_document(
                "doc-1",
                "lease.pdf",
                3,
                "--- Page 1 ---\nBase rent\n\n--- Page 2 ---\nRenewal option",
            ),
            make_document(
                "doc-2",
                "title.pdf",
                5,
                "--- Page 1 ---\nTitle commitments\n\n--- Page 4 ---\nExceptions",
            ),
        ]
    )

    response = (
        "The lease gives a renewal option (Doc 1, Page 2, Section 4.1). "
        "The title report lists exceptions (Doc 2, Page 4, Clause 7)."
    )

    citations = extract_citations(response, context)

    assert len(citations) == 2
    assert citations[0].document_id == "doc-1"
    assert citations[0].page == 2
    assert citations[0].section_or_clause == "Section 4.1"
    assert citations[0].valid is True
    assert citations[1].document_id == "doc-2"
    assert citations[1].page == 4
    assert citations[1].section_or_clause == "Clause 7"
    assert get_citation_status(citations) == "verified"
    assert get_confidence(True, "verified", citations) == "high"


def test_missing_citations_are_low_confidence() -> None:
    context = build_document_context(
        [make_document("doc-1", "lease.pdf", 2, "--- Page 1 ---\nBase rent")]
    )

    citations = extract_citations("The lease requires monthly rent payments.", context)

    assert citations == []
    assert get_citation_status(citations) == "failed"
    assert get_confidence(True, "failed", citations) == "low"


def test_invalid_page_citations_are_not_verified() -> None:
    context = build_document_context(
        [make_document("doc-1", "lease.pdf", 2, "--- Page 1 ---\nBase rent")]
    )

    citations = extract_citations(
        "The lease includes a guaranty (Doc 1, Page 9, Section 8).",
        context,
    )

    assert len(citations) == 1
    assert citations[0].valid is False
    assert get_citation_status(citations) == "failed"
    assert get_confidence(True, "failed", citations) == "low"


def test_heading_style_citations_are_accepted() -> None:
    context = build_document_context(
        [make_document("doc-3", "title-report.pdf", 4, "--- Page 2 ---\nEasements")]
    )

    citations = extract_citations(
        "There is a drainage easement affecting the property (Doc 1, Page 2, Easements).",
        context,
    )

    assert len(citations) == 1
    assert citations[0].page == 2
    assert citations[0].section_or_clause == "Easements"
    assert citations[0].valid is True
    assert get_citation_status(citations) == "verified"
    assert get_confidence(True, "verified", citations) == "high"


def test_build_unanswerable_response_includes_reason_and_missing_items() -> None:
    response = build_unanswerable_response(
        AnswerabilityAssessment(
            answerable=False,
            reason="The uploaded documents do not mention environmental remediation.",
            missing_information=[
                "An environmental assessment or remediation agreement.",
                "The page or clause discussing remediation obligations.",
            ],
        )
    )

    assert "I don't have enough information" in response
    assert "environmental remediation" in response
    assert "What I would need:" in response
    assert "remediation agreement" in response
