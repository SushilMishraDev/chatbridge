from typing import Literal
from pydantic import BaseModel, EmailStr, Field


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class GoogleAuthIn(BaseModel):
    credential: str = Field(min_length=1)
    dev_email: str | None = Field(default=None)


class RequestOtpIn(BaseModel):
    email: EmailStr


class VerifyOtpIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class MessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=5_000_000)


class SyncIn(BaseModel):
    source: str = Field(max_length=30)
    external_id: str = Field(max_length=255)
    title: str = Field(default="Untitled", max_length=500)
    messages: list[MessageIn] = Field(max_length=5000)
    created_at: str | None = None
    updated_at: str | None = None


class HandoffIn(BaseModel):
    conversation_id: int
    target: str
    next_message: str | None = Field(default=None, max_length=5000)


class PasteImportIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=500_000)
    source: str = Field(default="chatgpt", max_length=30)
