import './globals.css';

export const metadata = {
  title: 'G18 Gestión',
  description: 'Gestión financiera de G18 Corporation SAS y Gatotec 18',
  applicationName: 'G18 Gestión',
  // En el iPhone: "Agregar a pantalla de inicio" la abre como app, a pantalla completa
  appleWebApp: { capable: true, title: 'G18', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

export const viewport = {
  width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#4a235a',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
