'use client'

import { useState, useEffect, useRef } from 'react'
import { DirectMessage, User } from '../types'
import directMessageService from '../services/directMessageService'
import websocketService from '../services/websocketService'
import uploadService from '../services/uploadService'
import { useAuthStore } from '../store/store'
import p2pVoiceService from '../services/p2pVoiceService'
import { Phone, PhoneOff, Send, X, Clock, PlusCircle } from 'lucide-react'
import { UserAvatar } from './ui/user-avatar'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

interface DirectMessageAreaProps {
  friend: User
}

export function DirectMessageArea({ friend }: DirectMessageAreaProps) {
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const { user } = useAuthStore()
  const messagesEndRef = useRef<null | HTMLDivElement>(null)
  const messagesContainerRef = useRef<null | HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [skip, setSkip] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [viewingImage, setViewingImage] = useState<string | null>(null)

  // Загрузка сообщений с пагинацией
  const fetchMessages = async (loadSkip: number = 0, loadLimit: number = 30) => {
    if (isLoading) return
    setIsLoading(true)
    try {
      const messageHistory = await directMessageService.getMessages(friend.id, loadSkip, loadLimit)
      if (loadSkip === 0) {
        // Первоначальная загрузка
        setMessages(messageHistory)
        setSkip(messageHistory.length)
        setHasMore(messageHistory.length === loadLimit)
      } else {
        // Подгрузка старых сообщений
        setMessages((prev) => [...messageHistory, ...prev])
        setSkip(loadSkip + messageHistory.length)
        setHasMore(messageHistory.length === loadLimit)
      }
    } catch (error) {
      console.error('Ошибка загрузки личных сообщений:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Сброс состояния при смене пользователя
    setMessages([])
    setSkip(0)
    setHasMore(true)
    fetchMessages(0)
  }, [friend.id])

  useEffect(() => {
    const handleNewMessage = (payload: any) => {
      // WebSocket отправляет { type: 'dm', data: {...message} }
      const message: DirectMessage = payload.data || payload;
      
      console.log('[DirectMessageArea] Получено DM сообщение:', { payload, message, currentUser: user?.id, friend: friend.id });
      
      if (
        (message.sender_id === user?.id && message.recipient_id === friend.id) ||
        (message.sender_id === friend.id && message.recipient_id === user?.id)
      ) {
        setMessages((prev) => {
          // Проверяем, есть ли pending сообщение с тем же содержимым
          const pendingIndex = prev.findIndex(
            m => m.isPending && 
            m.sender_id === message.sender_id && 
            m.content === message.content
          );
          
          console.log('[DirectMessageArea] Поиск pending сообщения:', { 
            pendingIndex, 
            pendingMessages: prev.filter(m => m.isPending),
            incomingContent: message.content,
            incomingSender: message.sender_id
          });
          
          if (pendingIndex !== -1) {
            // Заменяем pending сообщение на подтвержденное
            console.log('[DirectMessageArea] Заменяем pending сообщение на подтвержденное');
            const updated = [...prev];
            updated[pendingIndex] = { ...message, isPending: false };
            return updated;
          }
          
          // Добавляем новое сообщение (от другого пользователя)
          console.log('[DirectMessageArea] Добавляем новое сообщение');
          return [...prev, message];
        });
      }
    };

    websocketService.on('dm', handleNewMessage);
    return () => {
      websocketService.off('dm', handleNewMessage);
    };
  }, [friend.id, user?.id]);

  // Обработчик прокрутки для подгрузки сообщений
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (container.scrollTop === 0 && hasMore && !isLoading) {
        fetchMessages(skip, 30);
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [skip, hasMore, isLoading, friend.id]);

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
    if (!newMessage.trim() && files.length === 0) return
    if (!user) return
    if (isSending) return

    const messageContent = newMessage;
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    
    setIsSending(true);

    try {
      // Загружаем файлы, если они есть
      const attachmentUrls: string[] = [];
      for (const file of files) {
        console.log('[DirectMessageArea] Загружаем файл:', file.name);
        const response = await uploadService.uploadFile(file);
        attachmentUrls.push(response.file_url);
        console.log('[DirectMessageArea] Файл загружен:', response.file_url);
      }

      // Создаем оптимистичное сообщение
      const optimisticMessage: DirectMessage = {
        id: tempId,
        tempId,
        content: messageContent,
        timestamp: new Date().toISOString(),
        sender_id: user.id,
        recipient_id: friend.id,
        isPending: true,
        author: user,
        attachments: attachmentUrls.map((url, index) => ({
          id: index,
          file_url: url,
          message_id: 0
        })),
        reactions: []
      };

      console.log('[DirectMessageArea] Отправка сообщения:', { optimisticMessage });

      // Добавляем сообщение в UI сразу
      setMessages((prev) => [...prev, optimisticMessage]);
      setNewMessage('');
      setFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      // Отправляем через WebSocket
      websocketService.send({
        type: 'dm_message',
        recipient_id: friend.id,
        content: messageContent,
        attachments: attachmentUrls
      });
    } catch (error) {
      console.error('[DirectMessageArea] Ошибка отправки:', error);
      alert('Не удалось отправить сообщение');
    } finally {
      setIsSending(false);
    }
  }

  const handleDeletePendingMessage = (tempId: string) => {
    setMessages((prev) => prev.filter(m => m.tempId !== tempId));
  }

  const handleImageClick = (imageUrl: string) => {
    setViewingImage(imageUrl);
  }

  const handleCloseImageViewer = () => {
    setViewingImage(null);
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
  }

  useEffect(() => {
    if(skip > 30) {
      // do not scroll to bottom if we are loading more messages
      return;
    }
    scrollToBottom()
  }, [messages]);

  // Функция для определения, является ли сообщение от текущего пользователя
  const isCurrentUserMessage = (message: DirectMessage) => {
    return message.sender_id === user?.id;
  };

  // Функция для получения пользователя для отображения
  const getUserForMessage = (message: DirectMessage) => {
    return isCurrentUserMessage(message) ? user : friend;
  };

  return (
    <div className="flex-1 flex flex-col bg-[#313338] min-h-0">
      {/* Top bar */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-[#2c2d32] shadow-md flex-shrink-0">
        <div className="flex items-center">
          <UserAvatar user={friend} />
          <h2 className="text-white font-semibold ml-3">{friend.username}</h2>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={() => p2pVoiceService.initiateCall(friend.id)} className="p-2 text-gray-400 hover:text-white">
            <Phone />
          </button>
          <button onClick={() => p2pVoiceService.hangUp(friend.id)} className="p-2 text-gray-400 hover:text-white">
            <PhoneOff />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 chat-scroll">
        {messages.map((msg, index) => {
          const prevMsg = messages[index - 1];
          const isCurrentUser = isCurrentUserMessage(msg);
          const messageUser = getUserForMessage(msg);
          // Показываем автора если это первое сообщение или предыдущее от другого пользователя
          const showAuthor = !prevMsg || prevMsg.sender_id !== msg.sender_id;
          const isPending = msg.isPending || false;
          
          return (
            <div key={msg.id} className={`flex items-start gap-3 ${isCurrentUser ? 'justify-end' : ''} mb-2 group`}>
              {!isCurrentUser && showAuthor && <UserAvatar user={messageUser as User} />}
              {!isCurrentUser && !showAuthor && <div className="w-10" />}

              <div className={`flex flex-col ${isCurrentUser ? 'items-end' : 'items-start'}`}>
                {showAuthor && (
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-white">{messageUser?.username}</p>
                    <p className="text-xs text-gray-400">
                      {format(new Date(msg.timestamp), 'd MMM yyyy, HH:mm', { locale: ru })}
                    </p>
                    {isPending && (
                      <div className="flex items-center gap-1 text-xs text-gray-400">
                        <Clock className="w-3 h-3" />
                        <span>Отправляется...</span>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex flex-col gap-2 max-w-lg">
                  {/* Attachments */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {msg.attachments.map(att => (
                        <div 
                          key={att.id}
                          onClick={() => handleImageClick(att.file_url)}
                          className="cursor-pointer"
                        >
                          <img 
                            src={att.file_url} 
                            alt="Вложение"
                            className={`max-w-xs max-h-80 rounded-md object-cover hover:opacity-90 transition-opacity ${isPending ? 'opacity-70' : ''}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Message content */}
                  {msg.content && (
                    <div className="flex items-center gap-2">
                      <div className={`${isPending ? 'text-gray-400 opacity-70' : 'text-white'} ${isCurrentUser ? 'bg-blue-600' : 'bg-gray-700'} rounded-lg px-3 py-2 ${isPending ? 'bg-opacity-70' : ''}`}>
                        {msg.content}
                      </div>
                      {isPending && isCurrentUser && msg.tempId && (
                        <button
                          onClick={() => handleDeletePendingMessage(msg.tempId!)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-500/20 rounded text-red-400"
                          title="Отменить отправку"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {isCurrentUser && showAuthor && <UserAvatar user={messageUser as User} />}
              {isCurrentUser && !showAuthor && <div className="w-10" />}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 pb-4 border-t border-[#2c2d32] flex-shrink-0">
        <form onSubmit={handleSendMessage} className="bg-[#383a40] rounded-lg flex flex-col">
          
          {/* File Previews */}
          {files.length > 0 && (
            <div className="flex gap-2 p-2 border-b border-[#2c2d32]">
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
                    className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          
          {/* Input Row */}
          <div className="px-4 flex items-center">
            <input 
              type="file"
              ref={fileInputRef}
              multiple
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <button 
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-gray-400 hover:text-white mr-2"
              disabled={files.length >= 3 || isSending}
              title="Прикрепить изображение"
            >
              <PlusCircle className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={`Написать @${friend.username}`}
              className="flex-1 bg-transparent text-white placeholder-gray-400 focus:outline-none py-3"
              disabled={isSending}
            />
            <button 
              type="submit" 
              className="text-gray-400 hover:text-white disabled:opacity-50" 
              disabled={(!newMessage.trim() && files.length === 0) || isSending}
            >
              <Send />
            </button>
          </div>
        </form>
      </div>

      {/* Image Viewer Popup */}
      {viewingImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90 backdrop-blur-sm"
          onClick={handleCloseImageViewer}
        >
          <button
            onClick={handleCloseImageViewer}
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors z-10"
            aria-label="Закрыть"
          >
            <X className="w-8 h-8" />
          </button>
          <img 
            src={viewingImage} 
            alt="Просмотр изображения"
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
