'use client'

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/store';
import { Button } from '../../components/ui/button';
import { Avatar } from '@mui/material';
import { X, Upload, Trash2, User } from 'lucide-react';
import { cn } from '../../lib/utils';
import authService from '../../services/authService';

const SIDEBAR_ITEMS = [
  {
    id: 'profile',
    label: 'Профиль',
    icon: User,
  }
];

export default function SettingsPage() {
  const router = useRouter();
  const { user, updateUser } = useAuthStore();
  const [activeTab, setActiveTab] = useState('profile');
  const [displayName, setDisplayName] = useState(user?.display_name || user?.username || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!user) {
    router.push('/login');
    return null;
  }

  const handleClose = () => {
    router.back();
  };

  const handleAvatarSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      const previewUrl = URL.createObjectURL(file);
      setAvatarPreview(previewUrl);
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarFile(null);
    setAvatarPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = async () => {
    setIsLoading(true);
    try {
      // Обновляем отображаемое имя
      if (displayName !== (user.display_name || user.username)) {
        await authService.updateProfile({ display_name: displayName });
      }

      // Загружаем аватар если выбран
      if (avatarFile) {
        await authService.uploadAvatar(avatarFile);
      }

      // Обновляем локальные данные пользователя
      updateUser({ ...user, display_name: displayName });
      
      // Показываем успешное сообщение (можно добавить toast)
      console.log('Профиль обновлен');
      
    } catch (error) {
      console.error('Ошибка обновления профиля:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAvatar = async () => {
    setIsLoading(true);
    try {
      await authService.deleteAvatar();
      setAvatarPreview(null);
      console.log('Аватар удален');
    } catch (error) {
      console.error('Ошибка удаления аватара:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background">
      {/* Header */}
      <div className="h-14 bg-background border-b border-border flex items-center justify-between px-4">
        <h1 className="text-lg font-semibold text-foreground">Настройки пользователя</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Sidebar */}
        <div className="w-64 bg-secondary border-r border-border p-4">
          <nav className="space-y-1">
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 text-left rounded-md transition-colors",
                    activeTab === item.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 p-6 overflow-y-auto">
          {activeTab === 'profile' && (
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold text-foreground mb-6">Мой профиль</h2>
              
              {/* Avatar Section */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-foreground mb-3">Аватар</h3>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <Avatar
                      src={avatarPreview || undefined}
                      sx={{
                        width: 80,
                        height: 80,
                        fontSize: '32px',
                        backgroundColor: 'rgb(88, 101, 242)',
                        fontWeight: 600,
                      }}
                    >
                      {displayName[0]?.toUpperCase()}
                    </Avatar>
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading}
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      Загрузить изображение
                    </Button>
                    
                    {(avatarPreview || user.avatar_url) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDeleteAvatar}
                        disabled={isLoading}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Удалить
                      </Button>
                    )}
                  </div>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarSelect}
                    className="hidden"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Рекомендуемое разрешение: не менее 128x128. Форматы: JPG, PNG, GIF.
                </p>
              </div>

              {/* Display Name */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-foreground mb-2">
                  Отображаемое имя
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="Введите отображаемое имя"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Это имя будет видно другим пользователям.
                </p>
              </div>

              {/* Username (readonly) */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-foreground mb-2">
                  Имя пользователя
                </label>
                <input
                  type="text"
                  value={user.username}
                  readOnly
                  className="w-full px-3 py-2 bg-muted border border-border rounded-md text-muted-foreground cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Имя пользователя нельзя изменить.
                </p>
              </div>

              {/* Email (readonly) */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-foreground mb-2">
                  Электронная почта
                </label>
                <input
                  type="email"
                  value={user.email}
                  readOnly
                  className="w-full px-3 py-2 bg-muted border border-border rounded-md text-muted-foreground cursor-not-allowed"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Адрес электронной почты нельзя изменить.
                </p>
              </div>

              {/* Save Button */}
              <div className="flex justify-end">
                <Button
                  onClick={handleSaveProfile}
                  disabled={isLoading || displayName === (user.display_name || user.username)}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isLoading ? 'Сохранение...' : 'Сохранить изменения'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
} 