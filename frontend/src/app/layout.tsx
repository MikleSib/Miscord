import type { Metadata, Viewport } from 'next'
import './styles/globals-01.css'
import './styles/globals-02.css'
import './styles/globals-02-02.css'
import './globals.css'
import './styles/globals-03.css'
import './mobile.css'
import './styles/mobile-01.css'
import './styles/mobile-02.css'
import './styles/mobile-03.css'
import './styles/mobile-04.css'
import ElectronTitleBar from '@/components/ElectronTitleBar'

export const metadata: Metadata = {
  title: {
    default: 'Miscord',
    template: '%s | Miscord',
  },
  description: 'Общайтесь в текстовых и голосовых каналах, созванивайтесь и делитесь экраном.',
  applicationName: 'Miscord',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark',
  themeColor: '#2c2d32',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className="dark">
      <body className="bg-background text-foreground">
        <ElectronTitleBar />
        {children}
      </body>
    </html>
  )
}
