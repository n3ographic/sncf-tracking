import type { ReactNode } from 'react';

export const metadata = { title: 'Observatoire TGV' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
