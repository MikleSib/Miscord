import { CapabilitiesProvider } from '@/features/capabilities/capabilities'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <CapabilitiesProvider>{children}</CapabilitiesProvider>
}
