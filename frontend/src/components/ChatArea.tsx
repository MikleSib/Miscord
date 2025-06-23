'use client'

import { useState, useRef, useEffect } from 'react'
import { Hash, Send, PlusCircle, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from './ui/button'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

export function ChatArea() {
  const { 
    currentChannel, 
    messages: allMessages, 
    user, 
    sendMessage,
    isLoading,
    sendTyping,
    typingStatus
  } = useStore()
  
  const [messageInput, setMessageInput] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const messages = currentChannel ? allMessages[currentChannel.id] || [] : []
  const currentTypingUsers = (currentChannel ? typingStatus[currentChannel.id] : []) || [];
  
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
    if (!messageInput.trim() && files.length === 0) return

    await sendMessage(messageInput, files)
    
    setMessageInput('')
    setFiles([])
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageInput(e.target.value);
    sendTyping();
  }
  
  const TypingIndicator = () => {
    if (currentTypingUsers.length === 0) return null;
    
    const users = currentTypingUsers.map(u => u.username);
    
    let text = '';
    if (users.length === 1) {
      text = `${users[0]} печатает...`;
    } else if (users.length > 1 && users.length < 4) {
      text = `${users.join(', ')} печатают...`;
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
      <div className="h-12 px-4 flex items-center border-b border-border flex-shrink-0">
        <Hash className="w-5 h-5 text-muted-foreground mr-2" />
        <span className="font-semibold">{currentChannel.name}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1">
        {messages.map((msg, index) => {
           const prevMsg = messages[index - 1];
           const showAuthor = !prevMsg || prevMsg.author.id !== msg.author.id || (new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()) > 5 * 60 * 1000;

          return (
            <div key={msg.id} className={`flex items-start gap-3 py-1 ${showAuthor ? 'mt-3' : ''}`}>
              {showAuthor ? (
                <Avatar>
                  <AvatarImage src={msg.author.avatar} />
                  <AvatarFallback>{msg.author.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
              ) : (
                 <div className="w-10 flex-shrink-0" /> 
              )}
              
              <div className="flex flex-col">
                {showAuthor && (
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold">{msg.author.username}</span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(msg.timestamp), 'd MMM yyyy, HH:mm', { locale: ru })}
                    </span>
                  </div>
                )}
                
                {msg.content && <p className="text-sm leading-relaxed">{msg.content}</p>}

                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mt-2 flex flex-col gap-2">
                    {msg.attachments.map(att => (
                      <a key={att.id} href={att.file_url} target="_blank" rel="noopener noreferrer">
                        <img 
                          src={att.file_url} 
                          alt="Вложение"
                          className="max-w-xs max-h-80 rounded-md object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>
      
      <TypingIndicator />

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
                placeholder={`Написать в #${currentChannel.name}`}
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