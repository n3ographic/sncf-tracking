import type { ReactNode } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import './carte.css';

export const metadata = { title: 'Observatoire TGV' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
