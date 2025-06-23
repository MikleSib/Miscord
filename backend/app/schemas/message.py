from pydantic import BaseModel, constr, field_serializer
from datetime import datetime, timezone
from typing import Optional, List
from app.schemas.user import UserResponse
from app.schemas.attachment import Attachment as AttachmentSchema

class MessageBase(BaseModel):
    content: Optional[constr(max_length=5000)] = None

class MessageCreate(MessageBase):
    text_channel_id: int
    attachments: Optional[List[str]] = []
    reply_to_id: Optional[int] = None

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
    reactions: List["ReactionResponse"] = []
    reply_to: Optional["Message"] = None

    @field_serializer('timestamp')
    def serialize_timestamp(self, dt: datetime) -> str:
        # Убеждаемся что время в UTC и сериализуем в ISO формате
        if dt.tzinfo is None:
            # Если timezone не указан, считаем что это UTC
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.isoformat()

    class Config:
        from_attributes = True

class MessageEvent(BaseModel):
    type: str  # "new_message", "edit_message", "delete_message"
    message: Optional[Message] = None
    message_id: Optional[int] = None
    text_channel_id: int

# Import after class definitions to avoid circular imports
from app.schemas.reaction import ReactionResponse

# Update forward references
Message.model_rebuild()