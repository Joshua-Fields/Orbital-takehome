from __future__ import annotations

import json
from collections.abc import AsyncIterator
from datetime import datetime

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from takehome.db.models import Message
from takehome.db.session import get_session
from takehome.services.conversation import get_conversation, update_conversation
from takehome.services.document import get_documents_for_conversation
from takehome.services.llm import (
    AnswerabilityAssessment,
    assess_answerability,
    build_document_context,
    build_unanswerable_response,
    chat_with_document,
    extract_citations,
    generate_title,
    get_citation_status,
    get_confidence,
)

logger = structlog.get_logger()

router = APIRouter(tags=["messages"])


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    sources_cited: int
    answerable: bool | None = None
    confidence: str | None = None
    citation_status: str | None = None
    answerability_reason: str | None = None
    citations: list[dict[str, object]] = Field(default_factory=list)
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    content: str


def serialize_message(message: Message) -> MessageOut:
    return MessageOut(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        content=message.content,
        sources_cited=message.sources_cited,
        answerable=message.answerable,
        confidence=message.confidence,
        citation_status=message.citation_status,
        answerability_reason=message.answerability_reason,
        citations=message.citations or [],
        created_at=message.created_at,
    )


# --------------------------------------------------------------------------- #
# Endpoints
# --------------------------------------------------------------------------- #


@router.get(
    "/api/conversations/{conversation_id}/messages",
    response_model=list[MessageOut],
)
async def list_messages(
    conversation_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[MessageOut]:
    """List all messages in a conversation, ordered by creation time."""
    # Verify the conversation exists
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
    )
    result = await session.execute(stmt)
    messages = list(result.scalars().all())
    return [serialize_message(message) for message in messages]


@router.post("/api/conversations/{conversation_id}/messages")
async def send_message(
    conversation_id: str,
    body: MessageCreate,
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """Send a user message and stream back the AI response via SSE."""
    # Verify the conversation exists
    conversation = await get_conversation(session, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Save the user message
    user_message = Message(
        conversation_id=conversation_id,
        role="user",
        content=body.content,
    )
    session.add(user_message)
    await session.commit()
    await session.refresh(user_message)

    logger.info("User message saved", conversation_id=conversation_id, message_id=user_message.id)

    # Load document text for the conversation
    documents = await get_documents_for_conversation(session, conversation_id)
    document_context = build_document_context(documents)

    # Load conversation history (exclude the message we just saved, it will be the user_message param)
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .where(Message.id != user_message.id)
        .order_by(Message.created_at.asc())
    )
    result = await session.execute(stmt)
    history_messages = list(result.scalars().all())

    conversation_history: list[dict[str, str]] = [
        {"role": m.role, "content": m.content} for m in history_messages
    ]

    # Determine if this is the first user message (for title generation)
    user_msg_count = sum(1 for m in history_messages if m.role == "user")
    is_first_message = user_msg_count == 0

    async def event_stream() -> AsyncIterator[str]:
        """Generate SSE events with the streamed LLM response."""
        full_response = ""
        assessment = AnswerabilityAssessment(answerable=False, reason=None)
        citations: list[dict[str, object]] = []
        citation_status = "not_applicable"
        confidence = "low"

        try:
            assessment = await assess_answerability(
                user_message=body.content,
                document_context=document_context,
                conversation_history=conversation_history,
            )

            if not assessment.answerable:
                full_response = build_unanswerable_response(assessment)
                event_data = json.dumps({"type": "content", "content": full_response})
                yield f"data: {event_data}\n\n"
            else:
                async for chunk in chat_with_document(
                    user_message=body.content,
                    document_context=document_context,
                    conversation_history=conversation_history,
                ):
                    full_response += chunk
                    event_data = json.dumps({"type": "content", "content": chunk})
                    yield f"data: {event_data}\n\n"

        except Exception:
            logger.exception(
                "Error during answerability check or LLM streaming",
                conversation_id=conversation_id,
            )
            error_msg = (
                "I'm sorry, an error occurred while generating a response. Please try again."
            )
            full_response = error_msg
            event_data = json.dumps({"type": "content", "content": error_msg})
            yield f"data: {event_data}\n\n"
            assessment = AnswerabilityAssessment(
                answerable=False,
                reason="The trust guardrails could not verify this answer because generation failed.",
            )

        if assessment.answerable:
            extracted_citations = extract_citations(full_response, document_context)
            citations = [citation.asdict() for citation in extracted_citations]
            citation_status = get_citation_status(extracted_citations)
            confidence = get_confidence(
                answerable=True,
                citation_status=citation_status,
                citations=extracted_citations,
            )
        else:
            citations = []
            citation_status = "not_applicable"
            confidence = "low"

        sources = len(citations)
        answerability_reason = assessment.reason
        if assessment.answerable and citation_status == "failed":
            answerability_reason = (
                "The answer was generated, but the citations were missing or could not be verified."
            )

        # Save the assistant message to the database.
        # We need a fresh session since the outer one may have been closed.
        from takehome.db.session import async_session as session_factory

        async with session_factory() as save_session:
            assistant_message = Message(
                conversation_id=conversation_id,
                role="assistant",
                content=full_response,
                sources_cited=sources,
                answerable=assessment.answerable,
                confidence=confidence,
                citation_status=citation_status,
                answerability_reason=answerability_reason,
                citations=citations,
            )
            save_session.add(assistant_message)
            await save_session.commit()
            await save_session.refresh(assistant_message)

            # Auto-generate title from first user message
            if is_first_message:
                try:
                    title = await generate_title(body.content)
                    await update_conversation(save_session, conversation_id, title)
                    logger.info(
                        "Auto-generated conversation title",
                        conversation_id=conversation_id,
                        title=title,
                    )
                except Exception:
                    logger.exception(
                        "Failed to generate title",
                        conversation_id=conversation_id,
                    )

            # Send the final message event with the complete assistant message
            message_data = json.dumps(
                {
                    "type": "message",
                    "message": serialize_message(assistant_message).model_dump(mode="json"),
                }
            )
            yield f"data: {message_data}\n\n"

            # Send the done signal
            done_data = json.dumps(
                {
                    "type": "done",
                    "sources_cited": sources,
                    "message_id": assistant_message.id,
                    "confidence": confidence,
                    "citation_status": citation_status,
                }
            )
            yield f"data: {done_data}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
