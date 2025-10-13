from pydantic import BaseModel, HttpUrl
from typing import Optional

class AttachmentBase(BaseModel):
    file_url: str  # Изменено с HttpUrl на str для гибкости

class AttachmentCreate(AttachmentBase):
    pass

class Attachment(AttachmentBase):
    id: int
    message_id: Optional[int] = None  # Опционально для DM (там будет dm_message_id)

    class Config:
        from_attributes = True 