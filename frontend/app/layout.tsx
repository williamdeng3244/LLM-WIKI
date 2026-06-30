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
    <html lang="zh-Hans" suppressHydrationWarning>
      <body>
        {/* Apply the saved theme + mode before first paint (no flash). The
            fallbacks MUST match the app defaults — 'slate' = DEFAULT_THEME_ID
            (lib/themes.ts) and 'dark' = the default mode (lib/theme.ts).
            Defaulting to 'aurora' here while the app default was 'slate' made a
            fresh machine flash the aurora video for one frame before snapping
            back to Slate. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var d=document.documentElement;d.setAttribute('data-theme-id',localStorage.getItem('wiki:theme-id')||'slate');var m=localStorage.getItem('wiki:theme');d.setAttribute('data-theme',(m==='light'||m==='dark')?m:'dark');}catch(e){}",
          }}
        />
        <BackgroundLayer />
        <SWRProvider>{children}</SWRProvider>
      </body>
    </html>
  );
}
