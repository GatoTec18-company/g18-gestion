import { ImageResponse } from 'next/og';

// Ícono de la app: "G18" blanco sobre el morado de la marca. margen > 0 deja espacio para íconos recortables (Android).
export function icono(tam, { margen = 0, redondo = false } = {}) {
  const interior = tam * (1 - margen * 2);
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #7b3f94 0%, #4a235a 100%)', borderRadius: redondo ? tam * 0.22 : 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: interior, height: interior }}>
          <div style={{ color: '#fff', fontSize: interior * 0.42, fontWeight: 800, letterSpacing: -interior * 0.02, lineHeight: 1 }}>G18</div>
          <div style={{ color: 'rgba(255,255,255,.75)', fontSize: interior * 0.1, fontWeight: 600, marginTop: interior * 0.05, letterSpacing: interior * 0.01 }}>GESTIÓN</div>
        </div>
      </div>
    ),
    { width: tam, height: tam },
  );
}
