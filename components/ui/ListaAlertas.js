import Link from 'next/link';

export default function ListaAlertas({ lista, max }) {
  if (!lista.length) return <p className="vacio">✅ Nada pendiente por ahora.</p>;
  const ver = max ? lista.slice(0, max) : lista;
  return (
    <>
      <ul className="alertas">
        {ver.map((a, i) => (
          <li key={i} className={`alerta-${a.nivel}`}>
            <span>{a.icono}</span>
            <span><Link href={a.href}><b>{a.texto}</b></Link><br /><span className="muted">{a.detalle}</span></span>
          </li>))}
      </ul>
      {max && lista.length > max && <p><Link href="/alertas">Ver las {lista.length} alertas →</Link></p>}
    </>
  );
}
