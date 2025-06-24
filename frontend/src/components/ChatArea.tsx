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
import { formatDateDivider } from '../lib/utils'
import uploadService from '../services/uploadService'
import enhancedWebSocketService from '../services/enhancedWebSocketService'
import reactionService from '../services/reactionService'

export function ChatArea({ showUserSidebar, setShowUserSidebar }: { showUserSidebar: boolean, setShowUserSidebar: (v: boolean) => void }) {
  const { currentChannel } = useStore()
  const { user, token } = useAuthStore()
  const { 
    messages, 
    isLoading: chatLoading, 
    error: chatError,
    loadMessageHistory,
    addMessage,
    updateMessageReactions,
    updateSingleReaction,
    deleteMessage,
    editMessage
  } = useChatStore()
  
  // Логируем изменения currentChannel
  useEffect(() => {
   
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
    console.log('[ChatArea] useEffect triggered', { 
      currentChannel: currentChannel?.id, 
      type: currentChannel?.type, 
      token: !!token 
    });

    if (currentChannel?.type === 'text') {
      loadMessageHistory(currentChannel.id);
      
      console.log('[ChatArea] Joining text channel:', currentChannel.id);
      
      // Присоединяемся к каналу (WebSocket соединение уже установлено в App)
      if (enhancedWebSocketService.isConnected()) {
        enhancedWebSocketService.joinChannel(currentChannel.id);
        console.log('[ChatArea] Joined channel:', currentChannel.id);
      } else {
        console.warn('[ChatArea] WebSocket not connected, cannot join channel');
        // WebSocket должен быть подключен в App.tsx, если нет - это проблема
      }

      // Подписка на новые сообщения для этого канала
      const unsubMsg = enhancedWebSocketService.onMessage('chat_message', (msg) => {
        // Проверяем, что сообщение для текущего канала
        if (msg.text_channel_id === currentChannel.id || msg.channel_id === currentChannel.id) {
          console.log('[ChatArea] Received chat_message for channel:', currentChannel.id, msg);
          const chatMessage = {
            ...msg,
            content: msg.content || '',
          };
          addMessage(chatMessage);
        }
      });

      // Подписка на печать для этого канала
      const unsubTyping = enhancedWebSocketService.onMessage('typing', (data) => {
        // Проверяем, что печать для текущего канала
        if (data.channel_id === currentChannel.id || data.text_channel_id === currentChannel.id) {
          console.log('[ChatArea] Received typing for channel:', currentChannel.id, data);
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
        }
      });

      // Подписка на удаление сообщений для этого канала
      const unsubDeleted = enhancedWebSocketService.onMessage('message_deleted', (data) => {
        if (data.text_channel_id === currentChannel.id || data.channel_id === currentChannel.id) {
          console.log('[ChatArea] Received message_deleted for channel:', currentChannel.id, data);
          deleteMessage(data.message_id);
        }
      });

      // Подписка на редактирование сообщений для этого канала
      const unsubEdited = enhancedWebSocketService.onMessage('message_edited', (msg) => {
        if (msg.text_channel_id === currentChannel.id || msg.channel_id === currentChannel.id) {
          console.log('[ChatArea] Received message_edited for channel:', currentChannel.id, msg);
          editMessage(msg.id, msg.content || '');
        }
      });

      // Подписка на обновление реакций для этого канала
      const unsubReaction = enhancedWebSocketService.onMessage('reaction_updated', (data) => {
        if (data.text_channel_id === currentChannel.id || data.channel_id === currentChannel.id) {
          console.log('[ChatArea] Received reaction_updated for channel:', currentChannel.id, data);
          updateSingleReaction(data.message_id, data.emoji, data.reaction);
        }
      });

      // Очистка подписок при смене канала/размонтировании
      return () => {
        console.log('[ChatArea] Cleaning up channel subscriptions for channel:', currentChannel.id);
        unsubMsg();
        unsubTyping();
        unsubDeleted();
        unsubEdited();
        unsubReaction();
        enhancedWebSocketService.leaveChannel(currentChannel.id);
        setTypingUsers([]);
      };
    } else {
      console.log('[ChatArea] Not a text channel, clearing typing users');
      setTypingUsers([]);
    }
  }, [currentChannel?.id, currentChannel?.type, loadMessageHistory, addMessage, deleteMessage, editMessage, token]);
  
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
    if (!messageInput.trim() && files.length === 0) {
      return;
    }
    if (!currentChannel || currentChannel.type !== 'text') {
      return;
    }
    setIsLoading(true)
    try {
      const attachmentUrls: string[] = [];
      for (const file of files) {
        const response = await uploadService.uploadFile(file);
        attachmentUrls.push(response.file_url);
      }
      enhancedWebSocketService.sendChatMessage(currentChannel.id, messageInput, attachmentUrls, replyingTo?.id);
      setMessageInput('')
      setFiles([])
      setReplyingTo(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
    } finally {
      setIsLoading(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageInput(e.target.value);
    if (currentChannel?.type === 'text') {
      enhancedWebSocketService.sendTyping(currentChannel.id);
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
      // toggleReaction возвращает обновленную реакцию
      const updatedReaction = await reactionService.toggleReaction(messageId, emoji);
      
      // Не обновляем локальное состояние здесь - оно будет обновлено через WebSocket
      // WebSocket получит событие reaction_updated и обновит состояние автоматически
      
    
    } catch (error) {
    
      
      // Если произошла ошибка, можем попробовать обновить локально
      try {
        const allReactions = await reactionService.getMessageReactions(messageId);
        updateMessageReactions(messageId, allReactions);
      } catch (fallbackError) {
      
      }
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
                    {formatDateDivider(msg.timestamp)}
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