from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db
from app.models.user import User
from app.schemas.user import UserCreate, User as UserSchema, Token, ProfileUpdate, AvatarResponse
from app.core.security import verify_password, get_password_hash, create_access_token
from app.core.dependencies import get_current_active_user
import os
import uuid
import shutil

router = APIRouter()

@router.post("/register", response_model=UserSchema)
async def register(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db)
):
    """Регистрация нового пользователя"""
    # Проверка существующего пользователя
    result = await db.execute(
        select(User).where(
            (User.username == user_data.username) | 
            (User.email == user_data.email)
        )
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email already registered"
        )
    
    # Создание нового пользователя
    hashed_password = get_password_hash(user_data.password)
    new_user = User(
        username=user_data.username,
        email=user_data.email,
        display_name=user_data.display_name,
        hashed_password=hashed_password
    )
    
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    return new_user

@router.post("/login", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db)
):
    """Вход пользователя"""
    # Поиск пользователя
    result = await db.execute(
        select(User).where(User.username == form_data.username)
    )
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Создание токена
    access_token = create_access_token(
        data={"sub": str(user.id)}
    )
    
    # Обновление статуса онлайн
    user.is_online = True
    await db.commit()
    
    return {"access_token": access_token, "token_type": "bearer"}

@router.get("/me", response_model=UserSchema)
async def get_current_user(
    current_user: User = Depends(get_current_active_user)
):
    """Получение информации о текущем пользователе"""
    return current_user

@router.put("/profile", response_model=UserSchema)
async def update_profile(
    profile_data: ProfileUpdate, 
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    current_user.display_name = profile_data.display_name
    await db.commit()
    await db.refresh(current_user)
    return current_user

@router.post("/avatar", response_model=AvatarResponse)
async def upload_avatar(
    avatar: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    # Проверяем тип файла
    if avatar.content_type not in ["image/jpeg", "image/png", "image/gif"]:
        raise HTTPException(
            status_code=400, 
            detail="Unsupported file type. Please upload JPG, PNG or GIF."
        )
    
    # Проверяем размер файла (максимум 5MB)
    if avatar.size > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 5MB.")
    
    # Создаем папку для uploads если не существует
    upload_dir = "static/uploads/avatars"
    os.makedirs(upload_dir, exist_ok=True)
    
    # Генерируем уникальное имя файла
    file_extension = avatar.filename.split(".")[-1]
    filename = f"{uuid.uuid4()}.{file_extension}"
    file_path = os.path.join(upload_dir, filename)
    
    # Сохраняем файл
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(avatar.file, buffer)
    
    # Удаляем старый аватар если есть
    if current_user.avatar_url:
        old_file_path = current_user.avatar_url.replace("/static/", "static/")
        if os.path.exists(old_file_path):
            os.remove(old_file_path)
    
    # Обновляем URL аватара в БД
    avatar_url = f"/static/uploads/avatars/{filename}"
    current_user.avatar_url = avatar_url
    await db.commit()
    
    return {"avatar_url": avatar_url}

@router.delete("/avatar")
async def delete_avatar(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.avatar_url:
        # Удаляем файл с диска
        file_path = current_user.avatar_url.replace("/static/", "static/")
        if os.path.exists(file_path):
            os.remove(file_path)
        
        # Удаляем URL из БД
        current_user.avatar_url = None
        await db.commit()
    
    return {"message": "Avatar deleted successfully"}