import type { Metadata, Viewport } from 'next'
import './globals.css'
import './mobile.css'
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
