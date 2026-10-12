import '@fontsource/hanken-grotesk/300.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'RiderX', description: 'RiderX operations and payroll' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="aurora" aria-hidden="true"><i className="arc1" /><i className="arc2" /><i className="arc3" /><i className="glow g1" /><i className="glow g2" /><i className="glow g3" /><i className="shade" /></div>
        {children}
      </body>
    </html>
  );
}
