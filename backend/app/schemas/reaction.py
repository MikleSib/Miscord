from pydantic import BaseModel
from typing import List
from app.schemas.user import UserResponse

class ReactionCreate(BaseModel):
    emoji: str
    message_id: int

class ReactionResponse(BaseModel):
    id: int
    emoji: str
    count: int
    users: List[UserResponse]
    current_user_reacted: bool

    class Config:
        from_attributes = True

class ReactionToggleRequest(BaseModel):
    emoji: str 