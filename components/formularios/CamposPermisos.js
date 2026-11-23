'use client';
import { useState } from 'react';
import { MODULOS, ROLES, permisosBase } from '@/lib/permisos';

// Rol + casillas de permisos. Al cambiar el rol se marcan los permisos típicos de ese rol; luego se pueden ajustar.
export default function CamposPermisos({ rolInicial = 'vendedor', permisosIniciales }) {
  const [rol, setRol] = useState(rolInicial);
  const [perm, setPerm] = useState(permisosIniciales ?? permisosBase(rolInicial));
  const grupos = [...new Set(MODULOS.map(m => m.grupo))];
  return (
    <>
      <label>Rol<select name="rol" value={rol} onChange={e => { setRol(e.target.value); setPerm(permisosBase(e.target.value)); }}>
        {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.t}</option>)}</select></label>
      <p className="muted ancho" style={{ margin: 0, alignSelf: 'center' }}>{ROLES[rol]?.d}</p>
      {rol === 'admin' ? <p className="ancho" style={{ margin: 0 }}><b>El administrador tiene todos los permisos.</b></p> : (
        <div className="casillas" style={{ gridColumn: '1 / -1' }}>
          {grupos.map(g => [
            <div className="grupo-t" key={g}>{g}</div>,
            ...MODULOS.filter(m => m.grupo === g).map(m => (
              <label className="casilla" key={m.k}>
                <input type="checkbox" name={`perm_${m.k}`} checked={!!perm[m.k]} onChange={e => setPerm(p => ({ ...p, [m.k]: e.target.checked }))} />
                <span>{m.t}<small>{m.d}</small></span>
              </label>
            )),
          ])}
        </div>
      )}
    </>
  );
}
