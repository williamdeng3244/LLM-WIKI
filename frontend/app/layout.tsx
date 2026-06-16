import type { Metadata } from 'next';
import BackgroundLayer from '@/components/BackgroundLayer';
import SWRProvider from '@/components/SWRProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Enflame Wiki',
  description: 'Internal company knowledge base',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Apply the saved theme + mode before first paint (no flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var d=document.documentElement;d.setAttribute('data-theme-id',localStorage.getItem('wiki:theme-id')||'aurora');var m=localStorage.getItem('wiki:theme');if(m==='light'||m==='dark')d.setAttribute('data-theme',m);}catch(e){}",
          }}
        />
        <BackgroundLayer />
        <SWRProvider>{children}</SWRProvider>
      </body>
    </html>
  );
}
