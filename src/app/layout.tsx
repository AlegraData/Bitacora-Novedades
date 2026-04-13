import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Bitácora Novedades Product | Alegra',
  description: 'Registro centralizado de novedades, pre-novedades y mejoras técnicas del equipo de Product.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" style={{ height: '100%' }}>
      <body style={{ margin: 0, minHeight: '100%', fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
        {children}
      </body>
    </html>
  )
}
