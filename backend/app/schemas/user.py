from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional

class UserBase(BaseModel):
    username: str
    email: EmailStr

class UserCreate(UserBase):
    password: str

class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None

class ProfileUpdate(BaseModel):
    display_name: str

class UserInDB(UserBase):
    id: int
    is_active: bool
    is_online: bool
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class User(UserInDB):
    pass

class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    
    class Config:
        from_attributes = True

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    user_id: Optional[int] = None

class AvatarResponse(BaseModel):
    avatar_url: str