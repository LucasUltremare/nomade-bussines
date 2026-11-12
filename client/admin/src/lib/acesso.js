/* ══════════════════════════════════════════════════════════
   ACESSO — o que a pessoa logada pode ver no crew.
   Vem do /api/auth/me. Serve SÓ pra montar a interface (menu,
   botões): quem barra de verdade é o servidor, rota a rota.
   ══════════════════════════════════════════════════════════ */

let atual = { socio: false, perms: [], propostasSoProprias: true };

export function setAcesso(a) {
  if (a && typeof a === "object") atual = { socio: !!a.socio, perms: a.perms || [], propostasSoProprias: a.propostasSoProprias !== false };
}
export const acesso = () => atual;
export const ehSocio = () => atual.socio;
export const pode = (modulo) => atual.socio || atual.perms.includes(modulo);
