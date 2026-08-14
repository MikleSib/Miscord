import type { Metadata, Viewport } from 'next'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/home.css'
import './styles/friend-dialog.css'
import './styles/direct-messages.css'
import './styles/direct-messages-mobile.css'
import './styles/secret-direct-messages.css'
import './styles/responsive.css'
import './styles/auth.css'
import './styles/mobile-layout.css'
import './styles/mobile-overlays.css'
import Script from 'next/script'
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
        <Script id="yandex-metrika" strategy="afterInteractive">
          {`(function(m,e,t,r,i,k,a){
            m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
            m[i].l=1*new Date();
            for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
            k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
          })(window,document,'script','https://mc.yandex.ru/metrika/tag.js?id=111567397','ym');
          ym(111567397,'init',{ssr:true,webvisor:true,clickmap:true,ecommerce:'dataLayer',referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true});`}
        </Script>
        <noscript dangerouslySetInnerHTML={{
          __html: '<div><img src="https://mc.yandex.ru/watch/111567397" style="position:absolute;left:-9999px" alt="" /></div>',
        }} />
      </body>
    </html>
  )
}
