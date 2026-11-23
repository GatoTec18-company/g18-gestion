export default function manifest() {
  return {
    name: 'G18 Gestión',
    short_name: 'G18',
    description: 'Caja, ventas financiadas, pedidos y deudas de G18 Corporation SAS y Gatotec 18',
    lang: 'es-CO',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#4a235a',
    theme_color: '#4a235a',
    icons: [
      { src: '/iconos/192', sizes: '192x192', type: 'image/png' },
      { src: '/iconos/512', sizes: '512x512', type: 'image/png' },
      { src: '/iconos/512-recortable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
