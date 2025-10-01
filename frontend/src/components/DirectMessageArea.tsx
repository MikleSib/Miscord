'use client'

import { useState, useEffect, useRef } from 'react'
import { DirectMessage, User } from '../types'
import directMessageService from '../services/directMessageService'
import websocketService from '../services/websocketService'
import { useAuthStore } from '../store/store'
import p2pVoiceService from '../services/p2pVoiceService'
import { Phone, PhoneOff, Send } from 'lucide-react'
import { UserAvatar } from './ui/user-avatar'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

interface DirectMessageAreaProps {
  friend: User
}

export function DirectMessageArea({ friend }: DirectMessageAreaProps) {
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const { user } = useAuthStore()
  const messagesEndRef = useRef<null | HTMLDivElement>(null)
  const messagesContainerRef = useRef<null | HTMLDivElement>(null)
  const [skip, setSkip] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(false)

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
    const handleNewMessage = (message: DirectMessage) => {
      if (
        (message.sender_id === user?.id && message.recipient_id === friend.id) ||
        (message.sender_id === friend.id && message.recipient_id === user?.id)
      ) {
        setMessages((prev) => [...prev, message]);
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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newMessage.trim() || !user) return

    websocketService.send({
      type: 'dm_message',
      recipient_id: friend.id,
      content: newMessage,
    });
    setNewMessage('')
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
          <button onClick={() => p2pVoiceService.startCall(friend.id)} className="p-2 text-gray-400 hover:text-white">
            <Phone />
          </button>
          <button onClick={() => p2pVoiceService.stopCall()} className="p-2 text-gray-400 hover:text-white">
            <PhoneOff />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 chat-scroll">
        {messages.map((msg, index) => {
          const nextMsg = messages[index + 1];
          const isCurrentUser = isCurrentUserMessage(msg);
          const messageUser = getUserForMessage(msg);
          const showAuthor = !nextMsg || nextMsg.sender_id !== msg.sender_id;
          return (
            <div key={msg.id} className={`flex items-start gap-3 ${isCurrentUser ? 'justify-end' : ''} mb-2`}>
              {!isCurrentUser && showAuthor && <UserAvatar user={messageUser as User} />}
              {!isCurrentUser && !showAuthor && <div className="w-10" />}

              <div className={`flex flex-col ${isCurrentUser ? 'items-end' : 'items-start'}`}>
                {showAuthor && (
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-white">{messageUser?.username}</p>
                    <p className="text-xs text-gray-400">
                      {format(new Date(msg.timestamp), 'd MMM yyyy, HH:mm', { locale: ru })}
                    </p>
                  </div>
                )}
                <div className={`mt-1 text-white ${isCurrentUser ? 'bg-blue-600' : 'bg-gray-700'} rounded-lg px-3 py-2 max-w-lg`}>
                  {msg.content}
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
        <form onSubmit={handleSendMessage} className="bg-[#383a40] rounded-lg px-4 flex items-center">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder={`Написать @${friend.username}`}
            className="flex-1 bg-transparent text-white placeholder-gray-400 focus:outline-none py-3"
          />
          <button type="submit" className="text-gray-400 hover:text-white" disabled={!newMessage.trim()}>
            <Send />
          </button>
        </form>
      </div>
    </div>
  )
}
