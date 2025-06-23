from pydantic import BaseModel, constr
from datetime import datetime
from typing import Optional, List
from app.schemas.user import UserResponse
from app.schemas.attachment import Attachment as AttachmentSchema

class MessageBase(BaseModel):
    content: Optional[constr(max_length=5000)] = None

class MessageCreate(MessageBase):
    text_channel_id: int
    attachments: Optional[List[str]] = []

class MessageUpdate(BaseModel):
    content: constr(max_length=5000)

class Message(BaseModel):
    id: int
    content: Optional[str]
    timestamp: datetime
    author: UserResponse
    text_channel_id: int
    is_edited: bool
    attachments: List[AttachmentSchema] = []

    class Config:
        from_attributes = True

class MessageEvent(BaseModel):
    type: str  # "new_message", "edit_message", "delete_message"
    message: Optional[Message] = None
    message_id: Optional[int] = None
    text_channel_id: int