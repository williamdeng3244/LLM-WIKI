import type { Metadata } from 'next';
import VideoBackground from '@/components/VideoBackground';
import './globals.css';

export const metadata: Metadata = {
  title: 'Enflame Wiki',
  description: 'Internal company knowledge base',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <VideoBackground />
        {children}
      </body>
    </html>
  );
}
