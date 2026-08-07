export const MAX_CHAT_COMPOSER_LINES = 25

function pixelValue(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function resizeChatComposer(element: HTMLTextAreaElement): void {
  const styles = window.getComputedStyle(element)
  const lineHeight = pixelValue(styles.lineHeight) || 20
  const verticalPadding = pixelValue(styles.paddingTop) + pixelValue(styles.paddingBottom)
  const verticalBorder = pixelValue(styles.borderTopWidth) + pixelValue(styles.borderBottomWidth)
  const maxHeight = Math.ceil(lineHeight * MAX_CHAT_COMPOSER_LINES + verticalPadding + verticalBorder)

  element.style.maxHeight = `${maxHeight}px`
  element.style.height = 'auto'
  const contentHeight = element.scrollHeight + verticalBorder
  element.style.height = `${Math.min(contentHeight, maxHeight)}px`
  element.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
}

export function resetChatComposer(element: HTMLTextAreaElement | null): void {
  if (!element) return
  element.style.height = 'auto'
  element.style.overflowY = 'hidden'
}
