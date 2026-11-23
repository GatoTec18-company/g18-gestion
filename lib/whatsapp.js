// Enlace que abre WhatsApp con el mensaje ya escrito (no necesita cuentas ni servicios).
export function telefonoWhatsApp(tel) {
  let d = String(tel ?? '').replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('3')) d = '57' + d;   // celular colombiano sin indicativo
  return d.length >= 11 ? d : null;
}
export const enlaceWhatsApp = (tel, texto) => {
  const n = telefonoWhatsApp(tel);
  return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(texto)}`;
};
