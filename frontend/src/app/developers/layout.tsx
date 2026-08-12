import { CapabilitiesProvider } from '@/features/capabilities/capabilities'

export default function DevelopersLayout({ children }: { children: React.ReactNode }) {
  return <CapabilitiesProvider>{children}</CapabilitiesProvider>
}
