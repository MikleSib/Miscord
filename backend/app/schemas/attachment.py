from pydantic import BaseModel, HttpUrl

class AttachmentBase(BaseModel):
    file_url: HttpUrl

class AttachmentCreate(AttachmentBase):
    pass

class Attachment(AttachmentBase):
    id: int
    message_id: int

    class Config:
        from_attributes = True 