import type { Metadata, Viewport } from 'next'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/responsive.css'
import ElectronTitleBar from '@/components/ElectronTitleBar'
import { AccessibilityRuntime } from '@/components/AccessibilityRuntime'
import { CapabilitiesProvider } from '@/features/capabilities/capabilities'

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
        <CapabilitiesProvider>
          <AccessibilityRuntime />
          <ElectronTitleBar />
          {children}
        </CapabilitiesProvider>
      </body>
    </html>
  )
}
