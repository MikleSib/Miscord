'use client'

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/store';
import { Button } from '../../components/ui/button';
import { UserAvatar } from '../../components/ui/user-avatar';
import { Accessibility, Bookmark, X, Upload, Trash2, User, Keyboard, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import authService from '../../services/authService';
import { applyUserProfileUpdate } from '../../lib/userProfileSync';
import { LogoutSection } from '../../components/settings/LogoutSection';
import { HotkeysSettings } from '../../components/settings/HotkeysSettings';
import type { UserSettingsTab } from '../../lib/userSettingsNavigation';
import { AccessibilitySettings } from '../../components/settings/AccessibilitySettings';
import { SecuritySettings } from '../../components/settings/SecuritySettings';
import { SavedMessagesSettings } from '../../components/settings/SavedMessagesSettings';

const SIDEBAR_ITEMS = [
  {
    id: 'saved',
    label: 'Сохранённые',
    icon: Bookmark,
  },
  {
    id: 'security',
    label: 'Безопасность',
    icon: ShieldCheck,
  },
  {
    id: 'profile',
    label: 'Профиль',
    icon: User,
  },
  {
    id: 'hotkeys',
    label: 'Горячие клавиши',
    icon: Keyboard,
  },
  {
    id: 'accessibility',
    label: 'Специальные возможности',
    icon: Accessibility,
  }
];

export default function SettingsPage() {
  console.log('SettingsPage рендерится');
  const router = useRouter();
  const { user, logout } = useAuthStore();
  console.log('Текущий пользователь в настройках:', user);
  const [activeTab, setActiveTab] = useState<UserSettingsTab>('profile');
  const [displayName, setDisplayName] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Исправляем гидратацию для SSR
  useEffect(() => {
    setMounted(true);
    if (user) {
      setDisplayName(user.display_name || user.username || '');
    }
  }, [user]);

  useEffect(() => {
    if (mounted && !user) {
      router.push('/login');
    }
  }, [mounted, user, router]);

  if (!mounted) {
    return null; // Предотвращаем рендеринг до гидратации
  }

  if (!user) {
    return null;
  }

  const handleClose = () => {
    router.back();
  };

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const handleAvatarSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setAvatarFile(file);
      const previewUrl = URL.createObjectURL(file);
      setAvatarPreview(previewUrl);
      
      // Автоматически загружаем аватар
      setIsLoading(true);
      try {
        const response = await authService.uploadAvatar(file);
        applyUserProfileUpdate({
          user_id: user.id,
          username: user.username,
          display_name: user.display_name,
          avatar_url: response.avatar_url,
        });
        console.log('Аватар загружен:', response.avatar_url);
      } catch (error) {
        console.error('Ошибка загрузки аватара:', error);
        // Откатываем изменения при ошибке
        setAvatarFile(null);
        setAvatarPreview(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } finally {
        setIsLoading(false);
      }
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
        applyUserProfileUpdate({
          user_id: user.id,
          username: user.username,
          display_name: displayName,
          avatar_url: user.avatar_url,
        });
      }
      
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
      setAvatarFile(null);
      applyUserProfileUpdate({
        user_id: user.id,
        username: user.username,
        display_name: user.display_name,
        avatar_url: null,
      });
      console.log('Аватар удален');
    } catch (error) {
      console.error('Ошибка удаления аватара:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="standalone-settings fixed inset-0 z-50 bg-background">
      {/* Header */}
      <div className="standalone-settings__header h-14 bg-background border-b border-border flex items-center justify-between px-4">
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

      <div className="standalone-settings__body flex h-[calc(100vh-3.5rem)]">
        {/* Sidebar */}
        <div className="standalone-settings__nav w-64 bg-secondary border-r border-border p-4">
          <nav className="space-y-1">
            {SIDEBAR_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as UserSettingsTab)}
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
        <div className="standalone-settings__content flex-1 p-6 overflow-y-auto">
          {activeTab === 'profile' && (
            <div className="max-w-2xl">
              <h2 className="text-xl font-semibold text-foreground mb-6">Мой профиль</h2>
              
              {/* Avatar Section */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-foreground mb-3">Аватар</h3>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <UserAvatar
                      user={{
                        username: user.username,
                        display_name: displayName,
                        avatar_url: avatarPreview || user.avatar_url,
                      }}
                      size={80}
                    />
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
                  disabled={isLoading || (displayName === (user.display_name || user.username) && !avatarFile)}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {isLoading ? 'Сохранение...' : 'Сохранить изменения'}
                </Button>
              </div>

              <LogoutSection onLogout={handleLogout} />
            </div>
          )}
          {activeTab === 'hotkeys' && <HotkeysSettings />}
          {activeTab === 'accessibility' && <AccessibilitySettings />}
          {activeTab === 'security' && <SecuritySettings />}
          {activeTab === 'saved' && <SavedMessagesSettings onNavigate={() => router.push('/')} />}
        </div>
      </div>
    </div>
  );
}
