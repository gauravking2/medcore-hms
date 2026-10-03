import type { Metadata } from 'next';
import { AppShell } from '../components/app-shell';
import { ThemeProvider } from '../components/theme';
import '../components/ui/design-system.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'MedCore HMS',
  description: 'A connected foundation for modern hospital care.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <Providers>
          <ThemeProvider>
            <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-teal-700 focus:px-3 focus:py-2 focus:text-sm focus:text-white">
              Skip to main content
            </a>
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}
