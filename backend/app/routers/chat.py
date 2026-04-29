"""RAG chat endpoint. Used by the web UI's chat panel and by personal agents.

Personal agents authenticate via Bearer token (ApiToken). Same endpoint, same
authorization, same answer grounded ONLY in published content.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import current_user
from app.core.db import get_session
from app.models import User
from app.schemas import ChatRequest, ChatResponse
from app.services.rag import answer

router = APIRouter()


@router.post("", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(current_user),
):
    text, citations = await answer(session, payload.message, payload.history)
    return ChatResponse(answer=text, citations=citations)
