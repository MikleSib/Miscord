import type { Metadata } from 'next'
import { Manrope } from 'next/font/google'
import { LandingPage } from '@/features/landing/LandingPage'

const manrope = Manrope({
  subsets: ['cyrillic', 'latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Miscord — общение, которое всегда рядом',
  description: 'Текстовые каналы, голос и совместный экран для ваших друзей и сообществ.',
}

export default function MarketingPage() {
  return <LandingPage className={manrope.className} />
}
