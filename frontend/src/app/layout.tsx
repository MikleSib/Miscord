import type { Metadata, Viewport } from 'next'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/home.css'
import './styles/responsive.css'
import ElectronTitleBar from '@/components/ElectronTitleBar'
import { AccessibilityRuntime } from '@/components/AccessibilityRuntime'

export const metadata: Metadata = {
  title: {
    default: 'Miscord',
    template: '%s | Miscord',
  },
  description: 'Общайтесь в текстовых и голосовых каналах, созванивайтесь и делитесь экраном.',
  applicationName: 'Miscord',
  verification: {
    yandex: '1548d8145354948f',
  },
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
        <AccessibilityRuntime />
        <ElectronTitleBar />
        {children}
      </body>
    </html>
  )
}
