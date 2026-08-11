'use client'

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store/store';
import { Button } from './ui/button';
import { UserAvatar } from './ui/user-avatar';
import { ChevronLeft, X, Upload, Trash2, User, Mic, Volume2, Bot } from 'lucide-react';
import { cn } from '../lib/utils';
import authService from '../services/authService';
import { VoiceVideoSettings } from './VoiceVideoSettings';
import { applyUserProfileUpdate } from '../lib/userProfileSync';
import { useMobileSettingsDetail } from '../hooks/useMobileSettingsDetail';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap';

const SIDEBAR_ITEMS = [
  {
    id: 'profile',
    label: 'Профиль',
    icon: User,
  },
  {
    id: 'voice',
    label: 'Голос и видео',
    icon: Mic,
  }
];

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Какую вкладку открыть при показе модалки */
  initialTab?: 'profile' | 'voice';
}

export default function SettingsModal({
  isOpen,
  onClose,
  initialTab = 'profile',
}: SettingsModalProps) {
  const router = useRouter();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'profile' | 'voice'>(initialTab);
  const [displayName, setDisplayName] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileSettings = useMobileSettingsDetail(isOpen, true);
  const closeModal = () => {
    mobileSettings.closeDetail();
    onClose();
  };
  const dialogRef = useModalFocusTrap<HTMLDivElement>(isOpen, closeModal);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (user && isOpen) {
      setDisplayName(user.display_name || user.username || '');
      setAvatarPreview(null);
      setAvatarFile(null);
    }
  }, [user, isOpen]);

  if (!isOpen || !user) {
    return null;
  }

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
    <div
      className="miscord-responsive-modal miscord-settings-dialog fixed inset-0 z-50 flex items-center justify-center"
      data-mobile-detail={mobileSettings.mobileDetailAttribute}
    >
      {/* Фон с размытием */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeModal}
      />

      {/* Модальное окно */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-settings-title"
        className="miscord-responsive-modal-card miscord-user-settings-panel relative bg-background border border-border rounded-lg shadow-xl w-full max-w-[84rem] h-[min(900px,92vh)] max-h-[92vh] overflow-hidden"
      >
        {/* Header */}
        <div className="miscord-settings-header h-14 bg-background border-b border-border flex items-center justify-between px-6">
          {mobileSettings.detailOpen && (
            <button type="button" onClick={mobileSettings.closeDetail} className="miscord-settings-back" aria-label="К разделам настроек">
              <ChevronLeft aria-hidden="true" />
            </button>
          )}
          <h1 id="user-settings-title" className="min-w-0 flex-1 truncate text-lg font-semibold text-foreground">
            {mobileSettings.detailOpen ? SIDEBAR_ITEMS.find((item) => item.id === activeTab)?.label : 'Настройки пользователя'}
          </h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={closeModal}
            aria-label="Закрыть настройки"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="miscord-settings-body flex h-[calc(100%-3.5rem)]">
          {/* Sidebar */}
          <div className="miscord-settings-sidebar w-64 bg-secondary border-r border-border p-4">
            <nav className="space-y-1">
              {SIDEBAR_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id as 'profile' | 'voice')
                      mobileSettings.openDetail()
                    }}
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
              <div className="my-2 border-t border-border" />
              <button
                onClick={() => {
                  onClose();
                  router.push('/developers');
                }}
                className="w-full flex items-center gap-3 px-3 py-2 text-left rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
              >
                <Bot className="w-4 h-4" />
                Developer Portal
              </button>
            </nav>
          </div>

          {/* Content */}
          <div className="miscord-settings-detail flex-1 p-6 overflow-y-auto">
            {activeTab === 'profile' && (
              <div className="max-w-2xl">
                <h2 className="miscord-settings-content-title text-xl font-semibold text-foreground mb-6">Мой профиль</h2>

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
              </div>
            )}

            {activeTab === 'voice' && (
              <div className="min-w-0">
                <VoiceVideoSettings />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
