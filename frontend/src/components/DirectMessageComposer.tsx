'use client'

import { PlusCircle, Reply, Send, X } from 'lucide-react'
import { MAX_CHAT_ATTACHMENTS } from '../lib/chatAttachments'
import { resizeChatComposer } from '../lib/chatComposer'
import { PendingAttachmentPreview } from './PendingAttachmentPreview'
import { ComposerEmojiButton } from './emoji/ComposerEmojiButton'

export function DirectMessageComposer({ model }: { model: any }) {
  const {
    isRateLimited, rateLimitHint, rateLimitRemainingSeconds, handleSendMessage,
    attachmentError, replyingTo, friend, handleCancelReply, files,
    handleRemoveFile, fileInputRef, handleFileChange, isSending,
    messageInputRef, newMessage, setNewMessage, handlePaste,
    applyFormattingShortcut,
  } = model
  return (
      <div className="direct-message-composer">
        {isRateLimited && (
          <div className="direct-message-composer__notice" role="status">
            {rateLimitHint || `Слишком быстро. Подождите ${rateLimitRemainingSeconds} сек.`}
          </div>
        )}
        <form onSubmit={handleSendMessage} className="direct-message-composer__form">
          {attachmentError && (
            <div className="direct-message-composer__error" role="alert">
              {attachmentError}
            </div>
          )}

          {replyingTo && (
            <div className="direct-message-composer__reply">
              <div>
                <Reply aria-hidden="true" />
                <div>
                  <p>Ответ для <strong>{replyingTo.author?.display_name || replyingTo.author?.username || friend.display_name || friend.username}</strong></p>
                  <span>{replyingTo.content || 'Вложение'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelReply}
                aria-label="Отменить ответ"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          )}

          {files.length > 0 && (
            <div className="direct-message-composer__files">
              {files.map((file: File, index: number) => (
                <PendingAttachmentPreview
                  key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                  file={file}
                  onRemove={() => handleRemoveFile(index)}
                />
              ))}
            </div>
          )}

          <div className="direct-message-composer__row">
            <input
              type="file"
              ref={fileInputRef}
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="direct-message-composer__attach"
              disabled={files.length >= MAX_CHAT_ATTACHMENTS || isSending || isRateLimited}
              title="Прикрепить файлы"
              aria-label="Прикрепить файлы"
            >
              <PlusCircle className="w-5 h-5" />
            </button>
            <textarea
              ref={messageInputRef}
              rows={1}
              style={{ resize: 'none', overflowY: 'hidden' }}
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (applyFormattingShortcut(e)) return
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
              onInput={(e) => resizeChatComposer(e.currentTarget)}
              placeholder={replyingTo ? 'Напишите ответ...' : `Написать @${friend.username}`}
              aria-label={`Сообщение для ${friend.display_name || friend.username}`}
              disabled={isSending || isRateLimited}
            />
            <div className="direct-message-composer__actions">
              <ComposerEmojiButton
                inputRef={messageInputRef}
                setValue={setNewMessage}
                disabled={isSending || isRateLimited}
              />
              <button
                type="submit"
                aria-label="Отправить сообщение"
                disabled={(!newMessage.trim() && files.length === 0) || isSending || isRateLimited}
              >
                <Send aria-hidden="true" />
              </button>
            </div>
          </div>
        </form>
      </div>
  )
}
