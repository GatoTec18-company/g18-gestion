import './globals.css';

export const metadata = { title: 'G18 Gestión', description: 'Gestión financiera de G18 Corporation SAS y Gatotec 18' };

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
