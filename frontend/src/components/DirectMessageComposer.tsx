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
    <>
      {/* Input */}
      <div className="px-4 pb-4 border-t border-[#2c2d32] flex-shrink-0">
        {isRateLimited && (
          <div className="mb-2 rounded-md border border-[#5865f2]/30 bg-[#5865f2]/10 px-3 py-2 text-sm text-[#dbdee1]">
            {rateLimitHint || `Слишком быстро. Подождите ${rateLimitRemainingSeconds} сек.`}
          </div>
        )}
        <form onSubmit={handleSendMessage} className="bg-[#393a41] rounded-lg flex flex-col">
          {attachmentError && (
            <div className="m-2 rounded-lg border border-[#da373c]/40 bg-[#da373c]/10 px-3 py-2 text-xs text-[#ffb8ba]">
              {attachmentError}
            </div>
          )}

          {/* Reply Preview */}
          {replyingTo && (
            <div className="flex items-center justify-between p-3 border-b border-[#2c2d32] bg-[#2c2d32]/50">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Reply className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-400">Ответ для {replyingTo.author?.username || friend.username}</p>
                  <p className="text-sm text-white truncate">{replyingTo.content || 'Изображение'}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelReply}
                className="text-gray-400 hover:text-white transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* File Previews */}
          {files.length > 0 && (
            <div className="flex gap-2 overflow-x-auto border-b border-[#2c2d32] p-2">
              {files.map((file: File, index: number) => (
                <PendingAttachmentPreview
                  key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                  file={file}
                  onRemove={() => handleRemoveFile(index)}
                />
              ))}
            </div>
          )}

          {/* Input Row */}
          <div className="px-4 flex items-center">
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
              className="text-gray-400 hover:text-white mr-2"
              disabled={files.length >= MAX_CHAT_ATTACHMENTS || isSending || isRateLimited}
              title="Прикрепить файлы"
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
              className="flex-1 bg-transparent text-white placeholder-gray-400 focus:outline-none py-3"
              disabled={isSending || isRateLimited}
            />
            <ComposerEmojiButton
              inputRef={messageInputRef}
              setValue={setNewMessage}
              disabled={isSending || isRateLimited}
              className="mr-2"
            />
            <button
              type="submit"
              className="text-gray-400 hover:text-white disabled:opacity-50"
              disabled={(!newMessage.trim() && files.length === 0) || isSending || isRateLimited}
            >
              <Send />
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
