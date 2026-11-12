import { useState, useEffect, useRef } from "react";
import { api, API } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { Button, Badge, Input, Select, Switch, Empty, Modal, PageHeader, useToast } from "../../components/ui.jsx";
import { useT } from "../../i18n/index.jsx";

/* ══════════════════════════════════════════════════════════════
   PROJETOS — o portfólio público (seção "Projetos" da home e
   "Trampos nossos" da vertical escolhida em `frente`).

   Cada projeto é um site/sistema de cliente no ar. A capa ninguém
   sobe: o server tira o print da URL (Chromium) quando o projeto é
   salvo, e dá pra pedir de novo quando o site mudar de cara.
   Só aparece no site o que está PUBLICADO e já tem capa.
   ══════════════════════════════════════════════════════════════ */

// valores são os salvos no server; o rótulo é traduzido na renderização
const FRENTE_KEYS = [
  { value: "site", key: "pj.fr.site" },
  { value: "ecommerce", key: "pj.fr.ecommerce" },
  { value: "crm", key: "pj.fr.crm" },
  { value: "agents", key: "pj.fr.agents" },
  { value: "marketing", key: "pj.fr.marketing" },
  { value: "apps", key: "pj.fr.apps" },
];
const frentes = (t) => FRENTE_KEYS.map((f) => ({ value: f.value, label: t(f.key) }));
const frenteLabel = (t, v) => { const f = FRENTE_KEYS.find((x) => x.value === v); return f ? t(f.key) : v; };

// a capa é rota pública do server principal → passa pelo proxy /hq
const capaUrl = (p) => `${API}/api/site/projetos/${p._id}/capa.jpg?v=${p.capaAt ? new Date(p.capaAt).getTime() : 0}`;

export function Projetos() {
  const { t } = useT();
  const [list, setList] = useState(null);
  const [clients, setClients] = useState([]);
  const [modal, setModal] = useState(null); // "new" | projeto
  const toast = useToast();
  const timer = useRef(null);

  const load = () => api.get("/api/admin/projetos").then(setList).catch(() => setList([]));

  useEffect(() => {
    load();
    api.get("/api/admin/clients").then(setClients).catch(() => {});
    return () => clearTimeout(timer.current);
  }, []);

  // enquanto alguma captura roda, recarrega a cada 3s até ela terminar
  useEffect(() => {
    clearTimeout(timer.current);
    if (list?.some((p) => p.capturando)) timer.current = setTimeout(load, 3000);
  }, [list]);

  const save = async (data) => {
    try {
      if (modal === "new") await api.post("/api/admin/projetos", data);
      else await api.patch(`/api/admin/projetos/${modal._id}`, data);
      setModal(null);
      load();
      toast(modal === "new" ? t("pj.toast.created") : t("pj.toast.saved"), { tone: "ok" });
    } catch (e) {
      const err = (() => { try { return JSON.parse(e.message).error; } catch { return ""; } })();
      toast(err === "url_invalid" ? t("pj.toast.url_invalid") : t("pj.toast.save_fail"), { tone: "danger" });
    }
  };

  const patch = async (p, data) => {
    setList((l) => l.map((x) => (x._id === p._id ? { ...x, ...data } : x)));
    try { await api.patch(`/api/admin/projetos/${p._id}`, data); } catch { toast(t("pj.toast.save_fail"), { tone: "danger" }); load(); }
  };

  const recapturar = async (p) => {
    setList((l) => l.map((x) => (x._id === p._id ? { ...x, capturando: true, capaErro: undefined } : x)));
    await api.post(`/api/admin/projetos/${p._id}/capturar`).catch(() => toast(t("pj.toast.capture_fail"), { tone: "danger" }));
  };

  const mover = async (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const nova = [...list];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setList(nova.map((p, k) => ({ ...p, ordem: k })));
    await Promise.all(nova.map((p, k) => (p.ordem !== k ? api.patch(`/api/admin/projetos/${p._id}`, { ordem: k }) : null)));
  };

  const del = async (p) => {
    if (!confirm(t("pj.confirm.delete", { name: p.nome }))) return;
    await api.del(`/api/admin/projetos/${p._id}`);
    load();
  };

  if (!list) return <div style={{ padding: 40, color: "var(--ink-mute)" }}>{t("pj.loading")}</div>;

  const publicados = list.filter((p) => p.publicado && p.capaAt).length;

  return (
    <div>
      <PageHeader
        title={t("pj.title")}
        subtitle={t("pj.subtitle", { n: publicados })}
        action={<Button variant="primary" icon="plus" onClick={() => setModal("new")}>{t("pj.new")}</Button>}
      />

      {list.length === 0 ? (
        <Empty icon="external" title={t("pj.empty.title")}>
          {t("pj.empty.body")}
        </Empty>
      ) : (
        <div className="ui-table">
          <table>
            <thead>
              <tr>
                <th style={{ width: 44 }}></th>
                <th style={{ width: 132 }}>{t("pj.th.cover")}</th>
                <th>{t("pj.th.project")}</th>
                <th style={{ width: 130 }}>{t("pj.th.front")}</th>
                <th style={{ width: 110 }}>{t("pj.th.on_site")}</th>
                <th style={{ width: 200 }}></th>
              </tr>
            </thead>
            <tbody>
              {list.map((p, i) => (
                <tr key={p._id}>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={i === 0} onClick={() => mover(i, -1)} aria-label={t("pj.up")}>↑</button>
                      <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" disabled={i === list.length - 1} onClick={() => mover(i, 1)} aria-label={t("pj.down")}>↓</button>
                    </div>
                  </td>
                  <td>
                    <div style={{
                      width: 120, aspectRatio: "16/10", borderRadius: 8, overflow: "hidden",
                      background: p.cor || "var(--sand, #eef6f9)", border: "1px solid var(--line)",
                      display: "grid", placeItems: "center", fontSize: "var(--t-2xs)", color: "var(--ink-faint)",
                    }}>
                      {p.capaAt
                        ? <img src={capaUrl(p)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top", display: "block" }} />
                        : p.capturando ? t("pj.capturing") : p.capaErro ? t("pj.no_cover") : "—"}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--s-2)", flexWrap: "wrap" }}>
                      <strong>{p.nome}</strong>
                      {p.destaque && <Badge tone="warn">{t("pj.badge.featured")}</Badge>}
                      {p.proprio && <Badge tone="info">{t("pj.badge.ours")}</Badge>}
                      {p.capturando && <Badge tone="info" dot>{t("pj.badge.capturing")}</Badge>}
                      {!p.capturando && p.capaErro && <Badge tone="danger" dot>{t("pj.badge.failed")}</Badge>}
                    </div>
                    <div style={{ fontSize: "var(--t-xs)", color: "var(--ink-mute)", marginTop: 2 }}>
                      <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{p.url}</a>
                      {p.resumo ? ` · ${p.resumo}` : ""}
                    </div>
                    {!p.capturando && p.capaErro && (
                      <div style={{ fontSize: "var(--t-2xs)", color: "var(--danger, #c0392b)", marginTop: 2 }}>{p.capaErro}</div>
                    )}
                  </td>
                  <td><Badge>{frenteLabel(t, p.frente)}</Badge></td>
                  <td>
                    <Switch checked={!!p.publicado} onChange={(v) => patch(p, { publicado: v })} label={p.publicado ? t("pj.yes") : t("pj.no")} />
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Button variant="ghost" size="sm" icon="refresh" disabled={p.capturando} onClick={() => recapturar(p)}>{t("pj.screenshot")}</Button>
                    <Button variant="ghost" size="sm" icon="edit" onClick={() => setModal(p)}>{t("pj.edit")}</Button>
                    <Button variant="ghost" size="sm" icon="trash" onClick={() => del(p)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <ProjetoModal initial={modal === "new" ? null : modal} clients={clients} onClose={() => setModal(null)} onSave={save} />}
    </div>
  );
}

function ProjetoModal({ initial, clients, onClose, onSave }) {
  const { t } = useT();
  const [f, setF] = useState(initial
    ? { ...initial, clientId: initial.clientId || "", cor: initial.cor || "" }
    : { nome: "", url: "", clientId: "", frente: "site", resumo: "", resumoEn: "", cor: "", destaque: false, proprio: false, publicado: false });
  const urlOk = !f.url || /^https?:\/\/\S+$/i.test(f.url);
  const corOk = !f.cor || /^#[0-9a-f]{6}$/i.test(f.cor);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  // escolher o cliente preenche o nome se ainda estiver vazio
  const escolherCliente = (id) => {
    const c = clients.find((x) => x._id === id);
    setF((x) => ({ ...x, clientId: id, nome: x.nome || c?.name || "" }));
  };

  const payload = () => ({
    nome: f.nome, url: f.url, clientId: f.clientId || null, frente: f.frente,
    resumo: f.resumo, resumoEn: f.resumoEn, cor: f.cor || "", destaque: !!f.destaque, proprio: !!f.proprio, publicado: !!f.publicado,
  });

  return (
    <Modal
      title={initial ? t("pj.modal.edit") : t("pj.new")}
      subtitle={t("pj.modal.sub")}
      size="wide"
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("pj.cancel")}</Button>
        <Button variant="primary" disabled={!f.nome || !f.url || !urlOk || !corOk} onClick={() => onSave(payload())}>{t("pj.save")}</Button>
      </>}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 var(--s-4)" }}>
        <Select label={t("pj.f.client")} placeholder={t("pj.f.client_none")} value={f.clientId} onChange={escolherCliente}
          options={clients.map((c) => ({ value: c._id, label: c.name }))} />
        <Input label={t("pj.f.name")} value={f.nome} onChange={set("nome")} placeholder={t("pj.f.name_ph")} />
        <Input label={t("pj.f.url")} value={f.url} onChange={set("url")} placeholder="https://…"
          error={!urlOk ? t("pj.f.url_err") : undefined} />
        <Select label={t("pj.f.front")} value={f.frente} onChange={set("frente")} options={frentes(t)}
          hint={t("pj.f.front_hint")} />
        <Input label={t("pj.f.summary")} value={f.resumo} onChange={set("resumo")} maxLength={160} placeholder={t("pj.f.summary_ph")} />
        <Input label={t("pj.f.summary_en")} value={f.resumoEn} onChange={set("resumoEn")} maxLength={160} placeholder={t("pj.f.summary_en_ph")} />
        <Input label={t("pj.f.color")} value={f.cor} onChange={set("cor")} placeholder={t("pj.f.color_ph")}
          error={!corOk ? t("pj.f.color_err") : undefined} />
      </div>
      <div style={{ display: "flex", gap: "var(--s-5)", flexWrap: "wrap", marginTop: "var(--s-2)" }}>
        <Switch checked={!!f.destaque} onChange={set("destaque")} label={t("pj.sw.featured")} />
        <Switch checked={!!f.proprio} onChange={set("proprio")} label={t("pj.sw.own")} />
        <Switch checked={!!f.publicado} onChange={set("publicado")} label={t("pj.sw.published")} />
      </div>
    </Modal>
  );
}
