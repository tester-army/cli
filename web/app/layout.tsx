import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "@/app/globals.css"

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: "Tester Army",
  description: "Run orchestrated AI browser checks from a local dashboard.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.className} ${geistMono.variable}`}>
      <body className="min-h-svh overflow-x-hidden bg-background text-foreground">
        <div className="relative isolate min-h-svh overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[45vh] bg-[radial-gradient(circle_at_20%_20%,rgba(249,115,22,0.16),transparent_40%),radial-gradient(circle_at_80%_5%,rgba(249,115,22,0.12),transparent_35%)]" />
          <div className="noise-overlay" />
          <main className="mx-auto flex w-full max-w-7xl animate-fadeIn px-6 py-8 md:px-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
