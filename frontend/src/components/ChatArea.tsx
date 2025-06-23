'use client'

import React from 'react'
import { useState, useRef, useEffect } from 'react'
import { Hash, Send, PlusCircle, X, Users } from 'lucide-react'
import { useStore } from '../lib/store'
import { useAuthStore } from '../store/store'
import { useChatStore } from '../store/chatStore'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from './ui/button'
import { UserAvatar } from './ui/user-avatar'
import { ChatMessage } from './ChatMessage'
import { ReplyInput } from './ReplyInput'
import { Message } from '../types'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import chatService from '../services/chatService'
import uploadService from '../services/uploadService'
import reactionService from '../services/reactionService'

export function ChatArea({ showUserSidebar, setShowUserSidebar }: { showUserSidebar: boolean, setShowUserSidebar: (v: boolean) => void }) {
  const { currentChannel } = useStore()
  const { user, token } = useAuthStore()
  const { 
    messages, 
    isLoading: chatLoading, 
    error: chatError,
    loadMessageHistory,
    addMessage 
  } = useChatStore()
  
  // Логируем изменения currentChannel
  useEffect(() => {
    console.log('[ChatArea] currentChannel изменился:', currentChannel);
  }, [currentChannel]);
  
  const [messageInput, setMessageInput] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [typingUsers, setTypingUsers] = useState<string[]>([])
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Загрузка истории сообщений при смене канала
  useEffect(() => {
    if (currentChannel?.type === 'text') {
      console.log('[ChatArea] Загружаем историю для канала', currentChannel.id);
      loadMessageHistory(currentChannel.id);
      
      // Подключаемся к WebSocket чата только если еще не подключены
      const accessToken = token || localStorage.getItem('access_token');
      console.log('[ChatArea] Проверяем токен для WebSocket:', { 
        hasToken: !!accessToken, 
        tokenLength: accessToken?.length,
        channelId: currentChannel.id,
        tokenFromStore: !!token,
        tokenFromStorage: !!localStorage.getItem('access_token')
      });
      
      if (accessToken) {
        console.log('[ChatArea] Подключаем WebSocket для канала', currentChannel.id);
        
        // Отключаемся от предыдущего соединения
        chatService.disconnect();
        
        // Небольшая задержка для завершения отключения
        setTimeout(() => {
          if (accessToken) {
            chatService.connect(currentChannel.id, accessToken);
          }
          
          // Обработчик новых сообщений
          chatService.onMessage((msg) => {
            console.log('[ChatArea] Получено сообщение через WebSocket:', msg);
            // Адаптируем Message к ChatMessage
            const chatMessage = {
              ...msg,
              content: msg.content || '', // Гарантируем что content не null
            };
            addMessage(chatMessage);
          });
          
          // Обработчик печати
          chatService.onTyping((data) => {
            if (data.user && data.user.username) {
              setTypingUsers(prev => {
                if (!prev.includes(data.user.username)) {
                  const newUsers = [...prev, data.user.username];
                  setTimeout(() => {
                    setTypingUsers(current => current.filter(u => u !== data.user.username));
                  }, 2000);
                  return newUsers;
                }
                return prev;
              });
            }
          });
        }, 100);
      }
    } else {
      console.log('[ChatArea] Канал не текстовый, отключаем WebSocket');
      chatService.disconnect();
      setTypingUsers([]);
    }
    
    // Cleanup function
    return () => {
      console.log('[ChatArea] Cleanup - отключаем WebSocket');
      chatService.disconnect();
      setTypingUsers([]);
    };
  }, [currentChannel?.id, currentChannel?.type, loadMessageHistory, addMessage, token]);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      if (files.length + selectedFiles.length > 3) {
        alert("Можно прикрепить не более 3 изображений.");
        return;
      }
      setFiles(prev => [...prev, ...selectedFiles]);
    }
  }

  const handleRemoveFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('[ChatArea] handleSendMessage вызван', { messageInput, files, currentChannel });
    
    if (!messageInput.trim() && files.length === 0) {
      console.log('[ChatArea] Пустое сообщение, отмена отправки');
      return;
    }
    if (!currentChannel || currentChannel.type !== 'text') {
      console.log('[ChatArea] Нет канала или канал не текстовый', { currentChannel });
      return;
    }

    console.log('[ChatArea] Начинаем отправку сообщения');
    setIsLoading(true)
    try {
      const attachmentUrls: string[] = [];
      for (const file of files) {
        console.log('[ChatArea] Загружаем файл:', file.name);
        const response = await uploadService.uploadFile(file);
        attachmentUrls.push(response.file_url);
        console.log('[ChatArea] Файл загружен:', response.file_url);
      }
      
      console.log('[ChatArea] Отправляем сообщение через chatService', { 
        content: messageInput, 
        attachments: attachmentUrls,
        channelId: currentChannel.id,
        replyTo: replyingTo?.id 
      });
      
      chatService.sendMessage(messageInput, attachmentUrls, replyingTo?.id);
      
      console.log('[ChatArea] Сообщение отправлено, очищаем форму');
      setMessageInput('')
      setFiles([])
      setReplyingTo(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      console.error('[ChatArea] Ошибка отправки сообщения:', error);
    } finally {
      setIsLoading(false)
      console.log('[ChatArea] Отправка завершена');
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageInput(e.target.value);
    if (currentChannel?.type === 'text') {
      chatService.sendTyping();
    }
  }

  const handleReply = (message: Message) => {
    setReplyingTo(message);
  }

  const handleCancelReply = () => {
    setReplyingTo(null);
  }

  const handleReaction = async (messageId: number, emoji: string) => {
    try {
      await reactionService.toggleReaction(messageId, emoji);
      // TODO: Обновить реакции в реальном времени через WebSocket
      console.log('Реакция обновлена:', emoji, 'на сообщение:', messageId);
    } catch (error) {
      console.error('Ошибка при изменении реакции:', error);
    }
  }
  
  const TypingIndicator = () => {
    if (typingUsers.length === 0) return null;
    
    let text = '';
    if (typingUsers.length === 1) {
      text = `${typingUsers[0]} печатает...`;
    } else if (typingUsers.length > 1 && typingUsers.length < 4) {
      text = `${typingUsers.join(', ')} печатают...`;
    } else {
      text = 'Несколько человек печатают...';
    }

    return <div className="px-4 text-xs text-muted-foreground h-4 mb-1">{text}</div>;
  }

  if (!currentChannel) {
    return (
      <div className="flex-1 bg-background flex items-center justify-center">
        <div className="text-muted-foreground text-center">
          <p className="text-2xl mb-2">Добро пожаловать!</p>
          <p>Выберите канал для начала общения</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-background flex flex-col h-screen">
      {/* Channel Header */}
      <div className="h-12 px-4 flex items-center border-b border-border flex-shrink-0 justify-between">
        <div className="flex items-center">
          <Hash className="w-5 h-5 text-muted-foreground mr-2" />
          <span className="font-semibold">{currentChannel.name}</span>
        </div>
        <button
          className="ml-auto p-2 rounded hover:bg-muted transition flex items-center"
          title={showUserSidebar ? 'Скрыть список участников' : 'Показать список участников'}
          onClick={() => setShowUserSidebar(!showUserSidebar)}
        >
          <Users className="w-6 h-6 text-muted-foreground" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1 chat-scroll">
        {chatLoading && (
          <div className="text-center text-muted-foreground py-4">
            Загрузка истории сообщений...
          </div>
        )}
        
        {chatError && (
          <div className="text-center text-red-400 py-4">
            {chatError}
          </div>
        )}
        
        {messages.map((msg, index) => {
          const prevMsg = messages[index - 1];
          const showAuthor = !prevMsg || prevMsg.author.id !== msg.author.id || (new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()) > 5 * 60 * 1000;
          const showDateDivider =
            !prevMsg ||
            new Date(prevMsg.timestamp).toDateString() !== new Date(msg.timestamp).toDateString();

          return (
            <React.Fragment key={msg.id}>
              {showDateDivider && (
                <div className="date-divider">
                  <span>
                    {format(new Date(msg.timestamp), 'd MMMM yyyy', { locale: ru })}
                  </span>
                </div>
              )}
              <ChatMessage
                message={msg}
                showAuthor={showAuthor}
                onReply={handleReply}
                onReaction={handleReaction}
                currentUser={user || undefined}
              />
            </React.Fragment>
          )
        })}
        <div ref={messagesEndRef} />
      </div>
      
      <TypingIndicator />

      {/* Reply Input */}
      <ReplyInput replyingTo={replyingTo} onCancelReply={handleCancelReply} />

      {/* Message Input */}
      {currentChannel.type === 'text' && (
        <div className="p-4 border-t border-border flex-shrink-0">
          <form onSubmit={handleSendMessage} className="bg-secondary rounded-lg p-2 flex flex-col">
            
            {/* File Previews */}
            {files.length > 0 && (
              <div className="flex gap-2 mb-2 p-2 border-b border-border">
                {files.map((file, index) => (
                  <div key={index} className="relative">
                    <img 
                      src={URL.createObjectURL(file)} 
                      alt="preview"
                      className="w-20 h-20 object-cover rounded"
                    />
                    <button 
                      type="button"
                      onClick={() => handleRemoveFile(index)} 
                      className="absolute top-0 right-0 bg-black/50 text-white rounded-full p-0.5"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex items-center">
              <input 
                type="file"
                ref={fileInputRef}
                multiple
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button 
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => fileInputRef.current?.click()}
                className="mr-2"
                disabled={files.length >= 3}
              >
                <PlusCircle className="w-5 h-5" />
              </Button>
              <input
                type="text"
                value={messageInput}
                onChange={handleInputChange}
                placeholder={
                  replyingTo 
                    ? `Ответ пользователю ${replyingTo.author.username}...`
                    : `Написать в #${currentChannel.name}`
                }
                className="flex-1 bg-transparent outline-none text-sm"
                disabled={isLoading}
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={(!messageInput.trim() && files.length === 0) || isLoading}
              >
                {isLoading ? '...' : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </form>
        </div>
      )}

      {currentChannel.type === 'voice' && (
        <div className="p-4 text-center text-muted-foreground">
          <p>Голосовой канал: {currentChannel.name}</p>
          <p className="text-sm">Нажмите на канал для подключения к голосовому чату</p>
        </div>
      )}
    </div>
  )
}