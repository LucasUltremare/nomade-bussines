/* Markdown → React. Sem lib e sem dangerouslySetInnerHTML: memória é escrita
   por sócio E pelo orquestrador, então o texto nunca vira HTML — vira nó.
   Suporta o suficiente pra uma nota: título, ênfase, código, lista, citação,
   link, e os [[wikilinks]] estilo Obsidian, que navegam pela base. */
import { Fragment } from "react";
import { useT } from "../../i18n/index.jsx";

const INLINE = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;

/** Trecho inline: negrito, itálico, código, link e wikilink. `t` vem do componente. */
function inline(texto, onWiki, chave = "i", t = (k) => k) {
  const partes = String(texto).split(INLINE).filter(p => p !== "" && p !== undefined);
  return partes.map((p, i) => {
    const k = `${chave}-${i}`;
    if (p.startsWith("[[") && p.endsWith("]]")) {
      const nome = p.slice(2, -2).trim();
      return (
        <button key={k} type="button" className="md-wiki" onClick={() => onWiki?.(nome)} title={t("mem.open_link", { name: nome })}>
          {nome}
        </button>
      );
    }
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={k}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={k}>{p.slice(1, -1)}</code>;
    if (p.startsWith("*") && p.endsWith("*")) return <em key={k}>{p.slice(1, -1)}</em>;
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = link[2];
      // só http(s): evita javascript: vindo de texto colado
      if (!/^https?:\/\//i.test(href)) return <Fragment key={k}>{link[1]}</Fragment>;
      return <a key={k} href={href} target="_blank" rel="noreferrer noopener">{link[1]}</a>;
    }
    return <Fragment key={k}>{p}</Fragment>;
  });
}

export function Markdown({ texto, onWiki }) {
  const { t } = useT();
  const linhas = String(texto || "").split("\n");
  const blocos = [];
  let lista = null;      // acumula itens de uma lista em curso
  let codigo = null;     // acumula linhas de um bloco ```

  const fecharLista = () => {
    if (!lista) return;
    const Tag = lista.ord ? "ol" : "ul";
    blocos.push(<Tag key={`l${blocos.length}`} className="md-list">
      {lista.itens.map((it, i) => <li key={i}>{inline(it, onWiki, `l${blocos.length}-${i}`, t)}</li>)}
    </Tag>);
    lista = null;
  };

  linhas.forEach((linha, n) => {
    if (linha.trim().startsWith("```")) {
      if (codigo) { blocos.push(<pre key={`c${n}`} className="md-pre"><code>{codigo.join("\n")}</code></pre>); codigo = null; }
      else { fecharLista(); codigo = []; }
      return;
    }
    if (codigo) { codigo.push(linha); return; }

    const h = linha.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      fecharLista();
      const Tag = `h${h[1].length + 2}`; // h1 do markdown vira h3 na tela (o título já é h2)
      blocos.push(<Tag key={n} className="md-h">{inline(h[2], onWiki, `h${n}`, t)}</Tag>);
      return;
    }
    const li = linha.match(/^\s*[-*]\s+(.*)$/);
    const oli = linha.match(/^\s*\d+[.)]\s+(.*)$/);
    if (li || oli) {
      const ord = !!oli;
      if (!lista || lista.ord !== ord) { fecharLista(); lista = { ord, itens: [] }; }
      lista.itens.push((li || oli)[1]);
      return;
    }
    fecharLista();
    if (linha.trim().startsWith(">")) {
      blocos.push(<blockquote key={n} className="md-quote">{inline(linha.replace(/^\s*>\s?/, ""), onWiki, `q${n}`, t)}</blockquote>);
      return;
    }
    if (!linha.trim()) return; // linha em branco separa bloco
    blocos.push(<p key={n} className="md-p">{inline(linha, onWiki, `p${n}`, t)}</p>);
  });
  fecharLista();
  if (codigo) blocos.push(<pre key="cf" className="md-pre"><code>{codigo.join("\n")}</code></pre>);

  return <div className="md">{blocos}</div>;
}

/** Os [[nomes]] citados num texto — pra saber quem aponta pra quem. */
export function wikilinksDe(texto) {
  return [...String(texto || "").matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim());
}
