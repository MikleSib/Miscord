from pydantic import BaseModel
from datetime import datetime
from typing import Optional
from app.schemas.user import User

class MessageBase(BaseModel):
    content: str

class MessageCreate(MessageBase):
    text_channel_id: int

class MessageUpdate(BaseModel):
    content: str

class Message(MessageBase):
    id: int
    author_id: int
    text_channel_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None
    is_edited: bool
    author: User

    class Config:
        from_attributes = True

class MessageEvent(BaseModel):
    type: str  # "new_message", "edit_message", "delete_message"
    message: Optional[Message] = None
    message_id: Optional[int] = None
    text_channel_id: int