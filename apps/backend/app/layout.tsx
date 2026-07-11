import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pijin API',
  description: 'Backend API for the Pijin P2P offline payment system built on Stellar.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
