import { useEffect, useRef, useState } from "react";

/* ══════════════════════════════════════════════════════════
   PRESENÇA — deixa um item sair (e entrar) com animação.
   Recebe os ids visíveis agora. Quem acabou de sair continua
   na tela por `ms` com fase "saindo"; quem acabou de entrar
   fica `ms` em "entrando". No primeiro render nada anima.

   A saída é detectada no PRÓPRIO render em que o id some
   (comparando com o último conjunto confirmado): assim o
   elemento nunca desmonta e a transição de CSS sai do estado
   normal pro de saída, em vez de nascer já no fim.

   Uso: const fase = usePresenca(ids); fase(id) → "in" | "entrando" | "saindo" | null
   ══════════════════════════════════════════════════════════ */
export function usePresenca(ids, ms = 560) {
  const atual = new Set(ids);
  const chave = [...atual].sort().join("|");
  const confirmado = useRef(null);       // conjunto do último commit
  const timers = useRef({});
  const [saindo, setSaindo] = useState({});
  const [entrando, setEntrando] = useState({});

  const prev = confirmado.current;
  const saiuAgora = (id) => !!prev && prev.has(id) && !atual.has(id);
  const entrouAgora = (id) => !!prev && !prev.has(id) && atual.has(id);

  useEffect(() => {
    const agora = new Set(chave ? chave.split("|") : []);
    const antes = confirmado.current;
    confirmado.current = agora;
    if (!antes) return;
    const tira = (set, id) => set((o) => { if (!o[id]) return o; const n = { ...o }; delete n[id]; return n; });
    const agenda = (id, fn) => { clearTimeout(timers.current[id]); timers.current[id] = setTimeout(fn, ms); };
    for (const id of antes) if (!agora.has(id)) {
      tira(setEntrando, id);
      setSaindo((o) => ({ ...o, [id]: true }));
      agenda(id, () => tira(setSaindo, id));
    }
    for (const id of agora) if (!antes.has(id)) {
      tira(setSaindo, id);
      setEntrando((o) => ({ ...o, [id]: true }));
      agenda(id, () => tira(setEntrando, id));
    }
  }, [chave, ms]);

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  return (id) => {
    if (atual.has(id)) return entrando[id] || entrouAgora(id) ? "entrando" : "in";
    return saindo[id] || saiuAgora(id) ? "saindo" : null;
  };
}
