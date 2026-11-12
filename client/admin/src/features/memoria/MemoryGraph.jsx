/* TEIA DA MEMÓRIA — o grafo associativo que já existe no banco (campo `links`,
   vizinhos por cosseno) desenhado como grafo force-directed.
   Portado do MemoryWeb do Vlad e ficou interativo: passa o mouse e lê o título,
   clica e abre a memória. A memória aberta e os vizinhos dela acendem.

   Se nada se move e tudo aparece solto, não é bug de desenho: é a base sem
   embedding (OLLAMA_URL vazio ou backfill não rodado). */
import { useEffect, useRef } from "react";
import { useT } from "../../i18n/index.jsx";

const rnd = (a, b) => a + Math.random() * (b - a);
// `semTitulo` é o fallback já traduzido (o motor roda fora do React)
const tituloDe = (m, semTitulo) =>
  (m.title && m.title.trim()) || String(m.content || "").split("\n")[0].replace(/^#+\s*/, "").slice(0, 48) || semTitulo;

function motor(canvas, aoClicar) {
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, nos = [], arestas = [], raf, mouse = null, hover = null, selId = null;
  const porId = new Map();

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // reconcilia por id: memória que já estava na tela mantém a posição
  const setDados = (mems, selecionada, semTitulo = "") => {
    selId = selecionada || null;
    const lista = (mems || []).slice(0, 120);
    const presentes = new Set();
    for (const m of lista) {
      if (!m.id) continue;
      presentes.add(m.id);
      if (!porId.has(m.id)) {
        porId.set(m.id, {
          id: m.id, x: rnd(0.2, 0.8), y: rnd(0.2, 0.8),
          vx: rnd(-0.004, 0.004), vy: rnd(-0.004, 0.004),
          tw: Math.random() * 6.28,
        });
      }
      const n = porId.get(m.id);
      n.links = m.links || [];
      n.titulo = tituloDe(m, semTitulo);
      n.grau = (m.links || []).length;
    }
    for (const id of [...porId.keys()]) if (!presentes.has(id)) porId.delete(id);
    nos = [...porId.values()];
    arestas = [];
    const vistas = new Set();
    for (const n of nos) {
      for (const l of n.links || []) {
        const alvo = porId.get(l.id);
        if (!alvo) continue;
        const chave = n.id < l.id ? n.id + l.id : l.id + n.id;
        if (vistas.has(chave)) continue;
        vistas.add(chave);
        arestas.push({ a: n, b: alvo, w: l.score || 0.6 });
      }
    }
  };

  const DIST = 0.16; // distância-alvo entre ligadas → o que forma os clusters
  const frame = (t) => {
    if (!W || !H) { raf = requestAnimationFrame(frame); return; }
    ctx.clearRect(0, 0, W, H);

    // atração ao longo das associações + repulsão fraca geral (senão vira bola)
    for (const e of arestas) {
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
      const d = Math.hypot(dx, dy) || 1e-4;
      const f = (d - DIST) * 0.0018 * (0.5 + e.w);
      const ux = dx / d, uy = dy / d;
      e.a.vx += ux * f; e.a.vy += uy * f; e.b.vx -= ux * f; e.b.vy -= uy * f;
    }
    for (let i = 0; i < nos.length; i++) {
      for (let j = i + 1; j < nos.length; j++) {
        const dx = nos[j].x - nos[i].x, dy = nos[j].y - nos[i].y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0.02 || d2 < 1e-8) continue;
        const f = 0.000035 / d2;
        const d = Math.sqrt(d2), ux = dx / d, uy = dy / d;
        nos[i].vx -= ux * f; nos[i].vy -= uy * f; nos[j].vx += ux * f; nos[j].vy += uy * f;
      }
    }
    for (const n of nos) {
      n.vx *= 0.94; n.vy *= 0.94;
      n.x += n.vx * 0.016; n.y += n.vy * 0.016;
      if (n.x < 0.05) { n.x = 0.05; n.vx = Math.abs(n.vx); } else if (n.x > 0.95) { n.x = 0.95; n.vx = -Math.abs(n.vx); }
      if (n.y < 0.06) { n.y = 0.06; n.vy = Math.abs(n.vy); } else if (n.y > 0.94) { n.y = 0.94; n.vy = -Math.abs(n.vy); }
    }

    // quem está aceso: a selecionada, os vizinhos dela, e o hover
    const foco = hover?.id || selId;
    const vizinhos = new Set();
    if (foco) {
      vizinhos.add(foco);
      for (const e of arestas) {
        if (e.a.id === foco) vizinhos.add(e.b.id);
        if (e.b.id === foco) vizinhos.add(e.a.id);
      }
    }

    for (const e of arestas) {
      const aceso = !foco || (vizinhos.has(e.a.id) && vizinhos.has(e.b.id));
      ctx.strokeStyle = aceso
        ? `rgba(53, 195, 178, ${Math.min(0.55, 0.18 + e.w * 0.4)})`
        : "rgba(255, 255, 255, .035)";
      ctx.lineWidth = aceso ? 1.1 : 1;
      ctx.beginPath();
      ctx.moveTo(e.a.x * W, e.a.y * H);
      ctx.lineTo(e.b.x * W, e.b.y * H);
      ctx.stroke();
    }

    hover = null;
    const ts = t / 1000;
    for (const n of nos) {
      const px = n.x * W, py = n.y * H;
      const perto = mouse && Math.hypot(mouse.x - px, mouse.y - py) < 14;
      if (perto) hover = n;
      const aceso = !foco || vizinhos.has(n.id);
      const r = 3 + Math.min(4, (n.grau || 0) * 0.7) + (perto ? 2 : 0);
      const pulso = 0.75 + 0.25 * Math.sin(ts * 1.2 + n.tw);

      if (aceso) {
        const g = ctx.createRadialGradient(px, py, 0, px, py, r * 4);
        g.addColorStop(0, `rgba(53, 195, 178, ${0.5 * pulso})`);
        g.addColorStop(1, "rgba(53, 195, 178, 0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(px, py, r * 4, 0, 6.29); ctx.fill();
      }
      ctx.fillStyle = n.id === selId ? "#35c3b2" : aceso ? `rgba(242,244,245,${0.55 * pulso + 0.2})` : "rgba(242,244,245,.14)";
      ctx.beginPath(); ctx.arc(px, py, r, 0, 6.29); ctx.fill();

      // o nome só aparece quando cabe: com muita memória vira sopa de letra
      if ((perto || n.id === selId || (nos.length <= 28 && aceso))) {
        ctx.font = "11px Inter, sans-serif";
        ctx.fillStyle = perto || n.id === selId ? "rgba(242,244,245,.92)" : "rgba(242,244,245,.42)";
        ctx.textAlign = "center";
        ctx.fillText(n.titulo.slice(0, 26), px, py - r - 7);
      }
    }
    canvas.style.cursor = hover ? "pointer" : "default";
    raf = requestAnimationFrame(frame);
  };

  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onLeave = () => { mouse = null; };
  const onClick = () => { if (hover) aoClicar?.(hover.id); };
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("mouseleave", onLeave);
  canvas.addEventListener("click", onClick);

  resize();
  raf = requestAnimationFrame(frame);
  return {
    setDados, resize,
    dispose() {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("click", onClick);
    },
  };
}

export function MemoryGraph({ memorias, selecionada, onAbrir }) {
  const { t } = useT();
  const ref = useRef();
  const eng = useRef();

  useEffect(() => {
    eng.current = motor(ref.current, onAbrir);
    const ro = new ResizeObserver(() => eng.current?.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); eng.current?.dispose(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { eng.current?.setDados(memorias, selecionada, t("mem.untitled")); }, [memorias, selecionada, t]);

  const comLink = (memorias || []).filter(m => m.links?.length).length;
  return (
    <div className="mg">
      <canvas ref={ref} />
      {!comLink && (
        <div className="mg-vazio">
          <b>{t("mem.graph.empty_title")}</b>
          <span>{t("mem.graph.empty_text")}</span>
        </div>
      )}
    </div>
  );
}
