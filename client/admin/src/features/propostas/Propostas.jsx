import { useEffect, useState } from "react";
import { api } from "../../api/client.js";
import { ehSocio } from "../../lib/acesso.js";
import { Icon } from "../../components/Icon.jsx";
import {
  Button, Card, Segmented, Badge, Input, Field, Empty, Modal,
  Switch, PageHeader, Chip, useToast,
} from "../../components/ui.jsx";
import { useT, localeOf } from "../../i18n/index.jsx";
import { dinheiro, simbolo } from "../../lib/regional.js";

/* ══════════════════════════════════════════════════════════════
   PROPOSTAS — tela única, no espírito do vlad-proposta:
   descreve o job → IA gera (itens + editorial) → ajusta → publica
   → sai com o link estilizado da empresa que já cobra via
   Mercado Pago. Histórico embaixo. Preço vem do briefing (sem
   tabela): valores citados são respeitados, o resto é estimado.
   ══════════════════════════════════════════════════════════════ */

const brl = (n, lang) => dinheiro(n, lang, { maximumFractionDigits: 0 });
const fmtDate = (d, lang) => d ? new Date(d).toLocaleDateString(localeOf(lang), { day: "2-digit", month: "short" }) : "—";
const num3 = (n) => String(n).padStart(3, "0");

const STATUS = {
  draft:     { label: "pr.status.draft",     tone: "neutral" },
  published: { label: "pr.status.published", tone: "info" },
  paid:      { label: "pr.status.paid",      tone: "ok" },
  lost:      { label: "pr.status.lost",      tone: "danger" },
};

const errMsg = (e, fallback) => {
  try { const j = JSON.parse(e.message); return j.message || j.error || fallback; } catch { return fallback; }
};

export function Propostas({ openRequest }) {
  const { t } = useT();
  const [current, setCurrent] = useState(null);   // proposta em edição (null = composer)
  const [list, setList] = useState(null);
  const toast = useToast();

  const loadList = () => {
    api.get("/api/admin/propostas").then(setList).catch(() => setList([]));
  };
  useEffect(() => { loadList(); }, []);

  const openProposta = (id) => {
    api.get(`/api/admin/propostas/${id}`).then(setCurrent).catch(() => {
      toast(t("pr.not_found"), { tone: "danger" });
    });
  };

  // "Nova proposta" vindo do hub do cliente abre direto no editor
  useEffect(() => {
    if (openRequest?.propostaId) openProposta(openRequest.propostaId);
  }, [openRequest?.nonce]);

  return (
    <div>
      <PageHeader
        title={t("pr.title")}
        subtitle={t("pr.subtitle")}
        action={current && (
          <Button variant="secondary" icon="plus" onClick={() => setCurrent(null)}>{t("pr.new")}</Button>
        )}
      />

      {current
        ? <Editor p={current} setP={setCurrent} onDone={() => { setCurrent(null); loadList(); }} onRefreshList={loadList} />
        : <Composer onCreated={(prop) => { setCurrent(prop); loadList(); }} />}

      <Historico list={list} currentId={current?._id} onOpen={openProposta} onReload={loadList} />
    </div>
  );
}

/* ─── COMPOSER — escolhe o cliente, descreve e gera ────────── */
function Composer({ onCreated }) {
  const { t } = useT();
  const [clientes, setClientes] = useState(null);
  const [clienteId, setClienteId] = useState("");
  const [brief, setBrief] = useState("");
  const [contexto, setContexto] = useState("");
  const [mode, setMode] = useState("unica");
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get("/api/admin/clients").then(setClientes).catch(() => setClientes([]));
  }, []);

  const gerar = async (e) => {
    e?.preventDefault();
    if (!clienteId) {
      toast(t("pr.pick_client"), { tone: "warn", text: t("pr.pick_client_sub") });
      return;
    }
    if (brief.trim().length < 30) {
      toast(t("pr.brief_short"), { tone: "warn", text: t("pr.brief_short_sub") });
      return;
    }
    setLoading(true);
    try {
      const r = await api.post("/api/admin/propostas/gerar", { clienteId, brief, contexto, mode });
      const full = await api.get(`/api/admin/propostas/${r.id}`);
      toast(t("pr.generated", { n: num3(full.numero) }), { tone: "ok", text: t("pr.generated_sub") });
      setBrief(""); setContexto(""); setClienteId("");
      onCreated(full);
    } catch (e) {
      toast(t("pr.gen_fail"), { tone: "danger", text: errMsg(e, t("pr.gen_fail_sub")), duration: 7000 });
    } finally {
      setLoading(false);
    }
  };

  const montarManual = async () => {
    if (!clienteId) {
      toast(t("pr.pick_client"), { tone: "warn" });
      return;
    }
    setLoading("manual");
    try {
      const r = await api.post("/api/admin/propostas/manual", { clienteId, mode });
      const full = await api.get(`/api/admin/propostas/${r.id}`);
      toast(t("pr.created_blank", { n: num3(full.numero) }), { tone: "ok", text: t("pr.created_blank_sub") });
      setBrief(""); setContexto(""); setClienteId("");
      onCreated(full);
    } catch (e) {
      toast(t("pr.create_fail"), { tone: "danger", text: errMsg(e, ""), duration: 7000 });
    } finally {
      setLoading(false);
    }
  };

  if (clientes && clientes.length === 0) {
    return (
      <div style={{ maxWidth: 680, marginBottom: "var(--s-8)" }}>
        <Empty icon="clients" title={t("pr.no_clients_title")}>
          {t("pr.no_clients_body")}
        </Empty>
      </div>
    );
  }

  return (
    <form onSubmit={gerar} style={{ maxWidth: 680, marginBottom: "var(--s-8)" }}>
      <Card pad>
        <Field label={t("pr.client_req")} hint={t("pr.client_hint")}>
          <select className="ui-select" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">{t("pr.client_select")}</option>
            {(clientes || []).map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}{c.email ? ` · ${c.email}` : ""}{c.segment ? ` · ${c.segment}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("pr.brief_label")}>
          <textarea
            className="ui-textarea"
            rows={6}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder={t("pr.brief_ph")}
          />
          <span className="ui-field__hint">{t("pr.brief_count", { n: brief.length })}</span>
        </Field>
        <div style={{ display: "flex", gap: "var(--s-4)", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Field label={t("pr.context_label")}>
              <input className="ui-input" value={contexto} onChange={(e) => setContexto(e.target.value)}
                placeholder={t("pr.context_ph")} />
            </Field>
          </div>
          <Field label={t("pr.billing")}>
            <Segmented
              items={[{ id: "unica", label: t("pr.mode.unica") }, { id: "mensal", label: t("pr.mode.mensal") }]}
              value={mode}
              onChange={setMode}
            />
          </Field>
          <div style={{ marginBottom: "var(--s-4)", display: "flex", gap: "var(--s-2)" }}>
            <Button variant="primary" type="submit" icon="edit" loading={loading === true}>
              {loading === true ? t("pr.generating") : t("pr.gen_ai")}
            </Button>
            <Button variant="secondary" type="button" icon="edit" loading={loading === "manual"} onClick={montarManual}>
              {t("pr.manual")}
            </Button>
          </div>
        </div>
        <div className="ui-field__hint" style={{ marginTop: "calc(var(--s-2) * -1)" }}>
          {t("pr.manual_hint")}
        </div>
      </Card>
    </form>
  );
}

/* ─── EDITOR — revisa, publica, pega o link ────────────────── */
function Editor({ p, setP, onDone, onRefreshList }) {
  const { t, lang } = useT();
  const [busy, setBusy] = useState(null);
  const [publishUrl, setPublishUrl] = useState(null);
  const [confirmDo, setConfirmDo] = useState(null);
  const [clientes, setClientes] = useState(null);
  const [padrao, setPadrao] = useState([]);
  const [gerenciarPadrao, setGerenciarPadrao] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get("/api/admin/clients").then(setClientes).catch(() => setClientes([]));
    api.get("/api/admin/itens-padrao").then((r) => setPadrao(r.itens || [])).catch(() => setPadrao([]));
  }, []);

  const clienteSel = (clientes || []).find((c) => String(c._id) === String(p.clienteId));

  // "criou uma vez → salva como template": pega um item da proposta e joga no
  // catálogo de itens padrão, sem retypar. Dedup por descrição.
  const salvarComoPadrao = async (item) => {
    const desc = String(item?.descricao || "").trim();
    if (!desc) { toast(t("pr.item_no_desc"), { tone: "warn" }); return; }
    if (padrao.some((x) => x.descricao.toLowerCase() === desc.toLowerCase())) {
      toast(t("pr.already_default"), { tone: "warn" });
      return;
    }
    const novos = [...padrao, { descricao: desc, valorUnitario: Math.max(0, Math.round(Number(item.valorUnitario) || 0)) }];
    try {
      const r = await api.put("/api/admin/itens-padrao", { itens: novos });
      setPadrao(r.itens || novos);
      toast(t("pr.saved_default"), { tone: "ok", text: t("pr.saved_default_sub") });
    } catch {
      toast(t("pr.save_fail"), { tone: "danger" });
    }
  };

  const locked = p.status === "paid";
  const mensal = p.mode === "mensal";
  const total = (p.itens || []).reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
  const semConteudo = !p.conteudo;

  const set = (patch) => setP((prev) => ({ ...prev, ...patch }));
  const setConteudo = (patch) => set({ conteudo: { ...p.conteudo, ...patch } });

  const salvar = async (silent = false) => {
    setBusy("save");
    try {
      const r = await api.patch(`/api/admin/propostas/${p._id}`, {
        ...(p.clienteId ? { clienteId: String(p.clienteId) } : {}),
        mode: p.mode,
        itens: p.itens,
        mensalInfo: p.mensalInfo,
        split: p.split,
        validadeDias: p.validadeDias,
        observacoes: p.observacoes,
        prazo: p.prazo,
        conteudo: p.conteudo || undefined,
      });
      setP({ ...r.proposta, url: p.url });
      if (!silent) toast(t("pr.saved"), { tone: "ok" });
      onRefreshList();
      return true;
    } catch (e) {
      toast(t("pr.save_fail"), { tone: "danger", text: errMsg(e, "") });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const publicar = async () => {
    if (!(await salvar(true))) return;
    setBusy("publish");
    try {
      const r = await api.post(`/api/admin/propostas/${p._id}/publish`);
      setPublishUrl(r.url);
      const full = await api.get(`/api/admin/propostas/${p._id}`);
      setP(full);
      onRefreshList();
    } catch (e) {
      toast(t("pr.publish_fail"), { tone: "danger", text: errMsg(e, ""), duration: 7000 });
    } finally {
      setBusy(null);
    }
  };

  const regenerar = async () => {
    setBusy("regen");
    try {
      const r = await api.post(`/api/admin/propostas/${p._id}/gerar`, { brief: p.brief, contexto: p.contexto, mode: p.mode });
      setP({ ...r.proposta, url: p.url });
      toast(t("pr.regenerated"), { tone: "ok" });
      onRefreshList();
    } catch (e) {
      toast(t("pr.regen_fail"), { tone: "danger", text: errMsg(e, ""), duration: 7000 });
    } finally {
      setBusy(null);
    }
  };

  const liberarFinal = async () => {
    setBusy("final");
    try {
      const r = await api.post(`/api/admin/propostas/${p._id}/liberar-final`);
      navigator.clipboard?.writeText(r.url);
      toast(t("pr.final_released"), { tone: "ok", text: t("pr.link_copied_send") });
    } catch (e) {
      toast(t("pr.release_fail"), { tone: "danger", text: errMsg(e, "") });
    } finally { setBusy(null); }
  };

  // Plano mensal pago: gera (ou reaproveita a em aberto) a cobrança do próximo mês
  const novaMensalidade = async () => {
    setBusy("mensalidade");
    try {
      const r = await api.post(`/api/admin/propostas/${p._id}/mensalidade`);
      navigator.clipboard?.writeText(r.url);
      toast(r.reused ? t("pr.monthly_reused", { n: r.mensalidade }) : t("pr.monthly_created", { n: r.mensalidade }),
        { tone: "ok", text: t("pr.link_copied_send") });
    } catch (e) {
      toast(t("pr.monthly_fail"), { tone: "danger", text: errMsg(e, ""), duration: 7000 });
    } finally { setBusy(null); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-4)", marginBottom: "var(--s-8)" }}>
      {/* Barra da proposta em edição */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--s-3)", flexWrap: "wrap" }}>
        <h2 style={{ fontFamily: "var(--heading)", fontWeight: 700, fontSize: "var(--t-lg)", letterSpacing: "var(--tr-display)" }}>
          #{num3(p.numero)} · {p.cliente?.nome || t("pr.no_client")}
        </h2>
        <Badge tone={STATUS[p.status]?.tone}>{STATUS[p.status] ? t(STATUS[p.status].label) : p.status}</Badge>
        {p.acceptedAt && <Badge tone="info" dot>{t("pr.accepted")}</Badge>}
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--s-2)", flexWrap: "wrap" }}>
          <Button variant="secondary" icon="external" loading={busy === "save"}
            onClick={async () => {
              /* Abre a aba DENTRO do gesto do clique (senão o browser bloqueia
                 popup), salva as edições, e só então aponta pra página — a
                 prévia é renderizada do banco, então sem salvar ela sai velha. */
              const w = window.open("", "_blank");
              if (!locked && !semConteudo) {
                const ok = await salvar(true);
                if (!ok) { w?.close(); return; }
              }
              if (w) w.location = p.url;
              else window.open(p.url, "_blank");
            }}>
            {p.status === "draft" ? t("pr.preview") : t("pr.open")}
          </Button>
          {p.status !== "draft" && (
            <Button variant="secondary" icon="copy" onClick={() => {
              navigator.clipboard?.writeText(p.url);
              toast(t("pr.link_copied"), { tone: "ok" });
            }}>{t("pr.copy_link")}</Button>
          )}
          {locked && mensal && ehSocio() && (
            <Button variant="primary" icon="send" loading={busy === "mensalidade"} onClick={novaMensalidade}>
              {t("pr.new_monthly")}
            </Button>
          )}
          {!locked && !semConteudo && (
            <Button variant="primary" icon="send" loading={busy === "publish"}
              onClick={() => {
                if (p.status === "published") {
                  setConfirmDo({
                    title: t("pr.republish_q"),
                    text: t("pr.republish_text"),
                    action: publicar,
                  });
                } else {
                  publicar();
                }
              }}>
              {p.status === "published" ? t("pr.republish") : t("pr.publish")}
            </Button>
          )}
        </div>
      </div>

      {p.aviso && (
        <div style={{
          padding: "var(--s-3) var(--s-4)", border: "1px solid var(--warn-line)", borderRadius: "var(--r-md)",
          background: "var(--warn-soft)", color: "var(--warn-fg)", fontSize: "var(--t-sm)", lineHeight: "var(--lh-base)",
        }}>
          {p.aviso}
        </div>
      )}

      {semConteudo ? (
        <Card pad>
          <p style={{ fontSize: "var(--t-base)", color: "var(--ink-mute)", marginBottom: "var(--s-3)" }}>
            {t("pr.empty_draft")}
          </p>
          <Field label={t("pr.brief_ai")}>
            <textarea className="ui-textarea" rows={6} value={p.brief || ""} onChange={(e) => set({ brief: e.target.value })} />
          </Field>
          <div style={{ display: "flex", gap: "var(--s-2)" }}>
            <Button variant="primary" icon="refresh" loading={busy === "regen"} onClick={regenerar}>{t("pr.gen_ai")}</Button>
            <Button variant="secondary" icon="edit"
              onClick={() => set({ conteudo: { subtitle: "", intro: "", sections: [], extra: null, highlights: [], naoIncluido: [] } })}>
              {t("pr.manual")}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="m-1col" style={{ display: "grid", gridTemplateColumns: "minmax(280px, 1fr) minmax(320px, 1.3fr)", gap: "var(--s-4)", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-4)" }}>
            <Card title={t("pr.client_cond")} pad>
              <Field label={t("pr.linked_client")} hint={p.clienteId ? t("pr.linked_hint_has") : t("pr.linked_hint_none")}>
                <select
                  className="ui-select"
                  value={p.clienteId ? String(p.clienteId) : ""}
                  disabled={locked}
                  onChange={(e) => {
                    const id = e.target.value;
                    const c = (clientes || []).find((x) => String(x._id) === id);
                    set({
                      clienteId: id || null,
                      ...(c ? { cliente: { nome: c.name || "", email: c.email || "", whatsapp: c.contact || "" } } : {}),
                    });
                  }}
                >
                  <option value="">{t("pr.no_linked_opt")}</option>
                  {(clientes || []).map((c) => (
                    <option key={c._id} value={c._id}>{c.name}{c.email ? ` · ${c.email}` : ""}</option>
                  ))}
                </select>
              </Field>
              {(clienteSel || p.cliente?.nome) && (
                <div style={{
                  display: "flex", flexWrap: "wrap", gap: "var(--s-2) var(--s-4)",
                  padding: "var(--s-2) var(--s-3)", marginBottom: "var(--s-4)",
                  background: "var(--surface-2)", borderRadius: "var(--r-sm)",
                  fontSize: "var(--t-sm)", color: "var(--ink-soft)",
                }}>
                  <span><strong>{clienteSel?.name || p.cliente?.nome}</strong></span>
                  <span>{clienteSel?.email || p.cliente?.email || t("pr.no_email")}</span>
                  <span>{clienteSel?.contact || p.cliente?.whatsapp || ""}</span>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s-3)" }}>
                <Input label={t("pr.validity")} type="number" value={p.validadeDias} onChange={(v) => set({ validadeDias: v })} disabled={locked} />
                <Input label={t("pr.deadline")} value={p.prazo} onChange={(v) => set({ prazo: v })} disabled={locked} placeholder={t("pr.deadline_ph")} />
              </div>
              <Input label={t("pr.notes")} textarea value={p.observacoes} onChange={(v) => set({ observacoes: v })} disabled={locked} />
            </Card>

            {/* COBRANÇA — tudo que define o que o Mercado Pago vai cobrar */}
            <Card title={t("pr.billing")} pad>
              <Field label={t("pr.type")} hint={mensal ? t("pr.type_hint_mensal") : t("pr.type_hint_unica")}>
                <Segmented
                  items={[{ id: "unica", label: t("pr.mode.unica_long") }, { id: "mensal", label: t("pr.mode.mensal_long") }]}
                  value={mensal ? "mensal" : "unica"}
                  onChange={(v) => !locked && set({ mode: v, ...(v === "mensal" ? { split: false } : {}) })}
                />
              </Field>

              {!mensal && (
                <div style={{ marginBottom: "var(--s-4)" }}>
                  <Switch checked={!!p.split} onChange={(v) => !locked && set({ split: v })} label={t("pr.split_label")} />
                  {p.split && (
                    <div className="ui-field__hint" style={{ marginTop: "var(--s-1)" }}>
                      {t("pr.split_hint", { v: brl(Math.round(total / 2), lang) })}
                    </div>
                  )}
                </div>
              )}

              {!mensal && (
                <Input
                  label={t("pr.monthly_ops")}
                  type="number"
                  value={p.mensalInfo || ""}
                  onChange={(v) => set({ mensalInfo: v })}
                  disabled={locked}
                  hint={p.operacaoMensal?.min
                    ? t("pr.monthly_ops_hint_ai", { min: brl(p.operacaoMensal.min, lang), max: brl(p.operacaoMensal.max, lang) })
                    : t("pr.monthly_ops_hint")}
                />
              )}

              {/* Prévia do que será cobrado — o "valor" que o cliente paga */}
              <div style={{
                marginTop: "var(--s-2)", padding: "var(--s-3)",
                background: "var(--surface-2)", borderRadius: "var(--r-sm)",
                fontSize: "var(--t-sm)", lineHeight: 1.7,
              }}>
                <div className="label-mono" style={{ marginBottom: "var(--s-1)" }}>{t("pr.client_pays")}</div>
                {total <= 0 ? (
                  <span style={{ color: "var(--warn-fg)" }}>{t("pr.no_priced_items")}</span>
                ) : mensal ? (
                  <span><strong>{brl(total, lang)}{t("pr.per_month")}</strong> {t("pr.pays_monthly_sub")}</span>
                ) : p.split ? (
                  <>
                    <div><strong>{brl(Math.round(total / 2), lang)}</strong> {t("pr.pays_now")}</div>
                    <div style={{ color: "var(--ink-mute)" }}>{t("pr.pays_delivery", { v: brl(total - Math.round(total / 2), lang) })}</div>
                  </>
                ) : (
                  <span><strong>{brl(total, lang)}</strong> {t("pr.pays_full")}</span>
                )}
              </div>
            </Card>

            {(p.status === "published" || p.status === "paid") && p.deliveryPaymentLinkId && (
              <Card title={t("pr.two_pay")} pad>
                <p style={{ fontSize: "var(--t-sm)", color: "var(--ink-mute)", marginBottom: "var(--s-3)", lineHeight: "var(--lh-base)" }}>
                  {t("pr.two_pay_text")}
                </p>
                {ehSocio() ? (
                  <Button variant="secondary" icon="check" loading={busy === "final"} onClick={liberarFinal}>
                    {t("pr.release_final")}
                  </Button>
                ) : (
                  <span style={{ fontSize: "var(--t-xs)", color: "var(--ink-mute)" }}>{t("pr.partner_only")}</span>
                )}
              </Card>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-4)" }}>
            <ItensEditor
              itens={p.itens || []} mensal={mensal} locked={locked}
              padrao={padrao}
              onManagePadrao={ehSocio() ? () => setGerenciarPadrao(true) : undefined}
              onSavePadrao={ehSocio() ? salvarComoPadrao : undefined}
              onChange={(itens) => set({ itens })}
            />
            <Card title={t("pr.page_text")} pad
              action={!locked && (
                <Button variant="ghost" size="sm" icon="refresh" loading={busy === "regen"}
                  onClick={() => setConfirmDo({
                    title: t("pr.regen_q"),
                    text: t("pr.regen_text"),
                    action: regenerar,
                  })}>
                  {t("pr.regen")}
                </Button>
              )}>
              <Input label={t("pr.subtitle_label")} value={p.conteudo?.subtitle} onChange={(v) => setConteudo({ subtitle: v })} disabled={locked} />
              <Field label={t("pr.intro_label")}>
                <textarea className="ui-textarea" rows={3} value={p.conteudo?.intro || ""} disabled={locked}
                  onChange={(e) => setConteudo({ intro: e.target.value })} />
              </Field>

              <PilaresEditor
                sections={p.conteudo?.sections || []}
                locked={locked}
                onChange={(sections) => setConteudo({ sections })}
              />

              <div className="label-mono" style={{ margin: "var(--s-4) 0 var(--s-2)" }}>{t("pr.highlights")}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
                {[0, 1, 2].map((i) => {
                  const h = (p.conteudo?.highlights || [])[i] || { k: "", v: "" };
                  const setH = (patch) => {
                    const hs = [0, 1, 2].map((j) => (p.conteudo?.highlights || [])[j] || { k: "", v: "" });
                    hs[i] = { ...hs[i], ...patch };
                    setConteudo({ highlights: hs });
                  };
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: "var(--s-2)" }}>
                      <input className="ui-input" placeholder={t("pr.hl_key_ph")} value={h.k} disabled={locked}
                        onChange={(e) => setH({ k: e.target.value })} />
                      <input className="ui-input" placeholder={t("pr.hl_val_ph")} value={h.v} disabled={locked}
                        onChange={(e) => setH({ v: e.target.value })} />
                    </div>
                  );
                })}
              </div>

              <div className="label-mono" style={{ margin: "var(--s-4) 0 var(--s-2)" }}>{t("pr.not_included")}</div>
              <textarea className="ui-textarea" rows={3} disabled={locked}
                value={(p.conteudo?.naoIncluido || []).join("\n")}
                onChange={(e) => setConteudo({ naoIncluido: e.target.value.split("\n") })} />
            </Card>
          </div>
        </div>
      )}

      {!semConteudo && !locked && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button variant="secondary" loading={busy === "save"} onClick={() => salvar()}>{t("pr.save_changes")}</Button>
        </div>
      )}

      {publishUrl && (
        <Modal
          title={t("pr.published_title")}
          subtitle={t("pr.published_sub")}
          onClose={() => setPublishUrl(null)}
          footer={<>
            <Button variant="ghost" icon="external" onClick={() => window.open(publishUrl, "_blank")}>{t("pr.open")}</Button>
            <Button variant="primary" icon="copy" onClick={() => {
              navigator.clipboard?.writeText(publishUrl);
              toast(t("pr.link_copied"), { tone: "ok" });
            }}>{t("pr.copy_link")}</Button>
          </>}
        >
          <input className="ui-input mono" readOnly value={publishUrl} onFocus={(e) => e.target.select()} />
        </Modal>
      )}

      {confirmDo && (
        <Modal
          title={confirmDo.title}
          onClose={() => setConfirmDo(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setConfirmDo(null)}>{t("pr.cancel")}</Button>
            <Button variant={confirmDo.danger ? "danger" : "primary"} onClick={() => { const a = confirmDo.action; setConfirmDo(null); a(); }}>
              {t("pr.confirm")}
            </Button>
          </>}
        >
          <p style={{ fontSize: "var(--t-base)", color: "var(--ink-soft)", lineHeight: "var(--lh-base)" }}>{confirmDo.text}</p>
        </Modal>
      )}

      {gerenciarPadrao && (
        <ItensPadraoModal
          padrao={padrao}
          onClose={() => setGerenciarPadrao(false)}
          onSaved={(novos) => { setPadrao(novos); setGerenciarPadrao(false); }}
        />
      )}
    </div>
  );
}

/* ─── ITENS ────────────────────────────────────────────────── */
function ItensEditor({ itens, mensal, locked, padrao = [], onManagePadrao, onSavePadrao, onChange }) {
  const { t, lang } = useT();
  const [showPadrao, setShowPadrao] = useState(false);
  const total = itens.reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
  const upd = (i, patch) => onChange(itens.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const del = (i) => onChange(itens.filter((_, j) => j !== i));
  const add = () => onChange([...itens, { descricao: "", quantidade: 1, valorUnitario: 0 }]);
  const addPadrao = (it) => {
    onChange([...itens, { descricao: it.descricao, quantidade: 1, valorUnitario: it.valorUnitario }]);
    setShowPadrao(false);
  };

  const cell = { border: "none", background: "transparent", width: "100%", fontSize: "var(--t-base)", color: "var(--ink)", outline: "none", padding: 0 };
  const numCell = { ...cell, textAlign: "right", fontFamily: "var(--mono)", fontSize: "var(--t-sm)" };

  return (
    <Card title={mensal ? t("pr.items_monthly") : t("pr.items_build")} pad={false}
      action={!locked && (
        <div style={{ display: "flex", gap: "var(--s-1)", position: "relative" }}>
          <Button variant="ghost" size="sm" icon="list" onClick={() => setShowPadrao((v) => !v)}>{t("pr.defaults")}</Button>
          <Button variant="ghost" size="sm" icon="plus" onClick={add}>{t("pr.item")}</Button>
          {showPadrao && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 20,
              width: 300, maxHeight: 320, overflowY: "auto",
              background: "var(--surface)", border: "1px solid var(--line-strong)",
              borderRadius: "var(--r-md)", boxShadow: "var(--shadow-lg)", padding: "var(--s-2)",
            }}>
              {padrao.length === 0 ? (
                <div style={{ padding: "var(--s-3)", fontSize: "var(--t-sm)", color: "var(--ink-mute)", textAlign: "center" }}>
                  {t("pr.no_defaults")}
                </div>
              ) : padrao.map((it, i) => (
                <button key={i} type="button" onClick={() => addPadrao(it)}
                  style={{
                    display: "flex", justifyContent: "space-between", gap: "var(--s-3)", width: "100%",
                    padding: "var(--s-2) var(--s-3)", border: "none", background: "transparent",
                    borderRadius: "var(--r-sm)", cursor: "pointer", textAlign: "left",
                    fontSize: "var(--t-sm)", color: "var(--ink)",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <span>{it.descricao}</span>
                  <strong className="tnum" style={{ whiteSpace: "nowrap", color: "var(--ink-soft)" }}>{brl(it.valorUnitario, lang)}</strong>
                </button>
              ))}
              {onManagePadrao && <div style={{ borderTop: "1px solid var(--line)", marginTop: "var(--s-1)", paddingTop: "var(--s-1)" }}>
                <button type="button" onClick={() => { setShowPadrao(false); onManagePadrao?.(); }}
                  style={{
                    display: "flex", alignItems: "center", gap: "var(--s-2)", width: "100%",
                    padding: "var(--s-2) var(--s-3)", border: "none", background: "transparent",
                    borderRadius: "var(--r-sm)", cursor: "pointer", color: "var(--accent-fg)", fontSize: "var(--t-sm)", fontWeight: 600,
                  }}>
                  <Icon name="edit" size={13} /> {t("pr.manage_defaults")}
                </button>
              </div>}
            </div>
          )}
        </div>
      )}>
      <div className="ui-table" style={{ border: "none", borderRadius: 0 }}>
        <table>
          <thead>
            <tr>
              <th>{t("pr.col_stage")}</th>
              <th style={{ width: 52, textAlign: "right" }}>{t("pr.col_qty")}</th>
              <th style={{ width: 88, textAlign: "right" }}>{t("pr.col_unit", { cur: simbolo(lang) })}</th>
              <th style={{ width: 96, textAlign: "right" }}>{t("pr.col_subtotal")}</th>
              {!locked && <th style={{ width: 64 }}></th>}
            </tr>
          </thead>
          <tbody>
            {itens.map((it, i) => (
              <tr key={i}>
                <td>
                  <input style={cell} value={it.descricao} disabled={locked} placeholder={t("pr.stage_ph")}
                    onChange={(e) => upd(i, { descricao: e.target.value })} />
                </td>
                <td>
                  <input style={numCell} type="number" min="1" value={it.quantidade} disabled={locked}
                    onChange={(e) => upd(i, { quantidade: Math.max(1, Math.round(Number(e.target.value) || 1)) })} />
                </td>
                <td>
                  <input style={numCell} type="number" min="0" value={it.valorUnitario} disabled={locked}
                    onChange={(e) => upd(i, { valorUnitario: Math.max(0, Number(e.target.value) || 0) })} />
                </td>
                <td className="num" style={{ fontWeight: 600 }}>{brl(it.quantidade * it.valorUnitario, lang)}</td>
                {!locked && (
                  <td>
                    <div style={{ display: "flex", gap: 0 }}>
                      {onSavePadrao && (
                        <button className="icon-btn" onClick={() => onSavePadrao(it)} title={t("pr.save_as_default")} disabled={!it.descricao?.trim()}>
                          <Icon name="bookmark" size={13} />
                        </button>
                      )}
                      <button className="icon-btn" onClick={() => del(i)} title={t("pr.remove")}>
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
            <tr>
              <td colSpan={3} style={{
                textAlign: "right", fontFamily: "var(--heading)", fontSize: "var(--t-2xs)", fontWeight: 600,
                letterSpacing: "var(--tr-mono)", textTransform: "uppercase", color: "var(--ink-faint)", background: "var(--surface-2)",
              }}>
                {t("pr.total")}{mensal ? ` ${t("pr.per_month")}` : ""}
              </td>
              <td colSpan={locked ? 1 : 2} className="num" style={{
                fontFamily: "var(--heading)", fontSize: "var(--t-md)", fontWeight: 700, color: "var(--ink)", background: "var(--surface-2)",
              }}>
                {brl(total, lang)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ─── PILARES (editáveis) ──────────────────────────────────── */
function PilaresEditor({ sections, locked, onChange }) {
  const { t } = useT();
  const upd = (i, patch) => onChange(sections.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const del = (i) => onChange(sections.filter((_, j) => j !== i));
  // label default é conteúdo da proposta (vai pro servidor) — fica como está
  const add = () => onChange([
    ...sections,
    { label: `PILAR ${String(sections.length + 1).padStart(2, "0")}`, title: "", desc: "", items: [] },
  ]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "var(--s-4) 0 var(--s-2)" }}>
        <span className="label-mono">{t("pr.pillars")}</span>
        {!locked && sections.length < 4 && (
          <Button variant="ghost" size="sm" icon="plus" onClick={add}>{t("pr.pillar")}</Button>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-3)" }}>
        {sections.map((s, i) => (
          <div key={i} style={{ border: "1px solid var(--line)", borderRadius: "var(--r-md)", padding: "var(--s-3)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "88px 1fr auto", gap: "var(--s-2)", marginBottom: "var(--s-2)" }}>
              <input className="ui-input" value={s.label || ""} disabled={locked} placeholder={t("pr.pillar_label_ph")}
                style={{ fontFamily: "var(--mono)", fontSize: "var(--t-xs)", textTransform: "uppercase" }}
                onChange={(e) => upd(i, { label: e.target.value })} />
              <input className="ui-input" value={s.title || ""} disabled={locked} placeholder={t("pr.pillar_title_ph")}
                style={{ fontWeight: 600 }}
                onChange={(e) => upd(i, { title: e.target.value })} />
              {!locked && (
                <button className="icon-btn" title={t("pr.remove_pillar")} onClick={() => del(i)}>
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>
            <input className="ui-input" value={s.desc || ""} disabled={locked} placeholder={t("pr.pillar_desc_ph")}
              style={{ marginBottom: "var(--s-2)" }}
              onChange={(e) => upd(i, { desc: e.target.value })} />
            <textarea className="ui-textarea" rows={3} disabled={locked}
              placeholder={t("pr.pillar_items_ph")}
              value={(s.items || []).join("\n")}
              onChange={(e) => upd(i, { items: e.target.value.split("\n") })} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── HISTÓRICO ────────────────────────────────────────────── */
function Historico({ list, currentId, onOpen, onReload }) {
  const { t, lang } = useT();
  const [status, setStatus] = useState("");
  const [confirm, setConfirm] = useState(null); // { proposta, action: "lost"|"del" }
  const toast = useToast();

  if (!list) return <div style={{ padding: 24, color: "var(--ink-mute)" }}>{t("pr.loading")}</div>;

  const filtered = status ? list.filter((p) => p.status === status) : list;

  const copy = (url) => {
    navigator.clipboard?.writeText(url);
    toast(t("pr.link_copied"), { tone: "ok" });
  };

  const doAction = async () => {
    const { proposta, action } = confirm;
    setConfirm(null);
    try {
      if (action === "lost") {
        await api.post(`/api/admin/propostas/${proposta._id}/lost`);
        toast(t("pr.marked_lost"), { tone: "warn" });
      } else {
        await api.del(`/api/admin/propostas/${proposta._id}`);
        toast(t("pr.deleted"), { tone: "ok" });
      }
      onReload();
    } catch (e) {
      toast(t("pr.fail"), { tone: "danger", text: errMsg(e, "") });
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "var(--s-2)", alignItems: "center", marginBottom: "var(--s-3)", flexWrap: "wrap" }}>
        <h3 className="section-title" style={{ marginBottom: 0 }}>{t("pr.history")}</h3>
        <div style={{ display: "flex", gap: "var(--s-1)", marginLeft: "var(--s-3)" }}>
          <Chip active={!status} onClick={() => setStatus("")} style={{ cursor: "pointer" }}>{t("pr.all")}</Chip>
          {Object.entries(STATUS).map(([id, s]) => (
            <Chip key={id} active={status === id} onClick={() => setStatus(id)} style={{ cursor: "pointer" }}>{t(s.label)}</Chip>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty icon="report" title={t("pr.empty_title")}>
          {t("pr.empty_body")}
        </Empty>
      ) : (
        <div className="ui-table ui-table--clickable">
          <table>
            <thead>
              <tr>
                <th style={{ width: 52 }}>{t("pr.col_no")}</th>
                <th>{t("pr.col_client")}</th>
                <th style={{ width: 105, textAlign: "right" }}>{t("pr.col_value")}</th>
                <th style={{ width: 96 }}>{t("pr.col_status")}</th>
                <th style={{ width: 82 }}>{t("pr.col_opens")}</th>
                <th style={{ width: 72 }}>{t("pr.col_date")}</th>
                <th style={{ width: 118 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p._id} onClick={() => onOpen(p._id)}
                  style={currentId === p._id ? { background: "var(--selected)" } : undefined}>
                  <td className="mono">#{num3(p.numero)}</td>
                  <td>
                    <strong>{p.cliente?.nome || "—"}</strong>
                    {p.conteudo?.subtitle && <span style={{ color: "var(--ink-mute)", fontSize: "var(--t-sm)" }}> · {p.conteudo.subtitle}</span>}
                  </td>
                  <td className="num">{brl(p.total, lang)}{p.mode === "mensal" && <span style={{ color: "var(--ink-faint)" }}>{t("pr.per_month")}</span>}</td>
                  <td><Badge tone={STATUS[p.status]?.tone}>{STATUS[p.status] ? t(STATUS[p.status].label) : p.status}</Badge></td>
                  <td className="num">{p.opens?.length || 0}</td>
                  <td style={{ color: "var(--ink-mute)", fontSize: "var(--t-sm)" }}>{fmtDate(p.updatedAt, lang)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 2, justifyContent: "flex-end" }}>
                      <button className="icon-btn" title={t("pr.open_page")} onClick={() => window.open(p.url, "_blank")}>
                        <Icon name="external" size={14} />
                      </button>
                      {p.status !== "draft" && (
                        <button className="icon-btn" title={t("pr.copy_link")} onClick={() => copy(p.url)}>
                          <Icon name="copy" size={14} />
                        </button>
                      )}
                      {["draft", "published"].includes(p.status) && (
                        <button className="icon-btn" title={t("pr.mark_lost")} onClick={() => setConfirm({ proposta: p, action: "lost" })}>
                          <Icon name="close" size={14} />
                        </button>
                      )}
                      {["draft", "lost"].includes(p.status) && ehSocio() && (
                        <button className="icon-btn" title={t("pr.delete")} onClick={() => setConfirm({ proposta: p, action: "del" })}>
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirm && (
        <Modal
          title={confirm.action === "lost" ? t("pr.lost_q") : t("pr.delete_q")}
          onClose={() => setConfirm(null)}
          footer={<>
            <Button variant="ghost" onClick={() => setConfirm(null)}>{t("pr.cancel")}</Button>
            <Button variant="danger" onClick={doAction}>{t("pr.confirm")}</Button>
          </>}
        >
          <p style={{ fontSize: "var(--t-base)", color: "var(--ink-soft)", lineHeight: "var(--lh-base)" }}>
            {t(confirm.action === "lost" ? "pr.lost_text" : "pr.delete_text", {
              n: num3(confirm.proposta.numero),
              c: confirm.proposta.cliente?.nome || "",
            })}
          </p>
        </Modal>
      )}
    </div>
  );
}

/* ─── ITENS PADRÃO — gerenciador do catálogo (produtos com preço padrão) ─── */
function ItensPadraoModal({ padrao, onClose, onSaved }) {
  const { t, lang } = useT();
  const [list, setList] = useState(() => padrao.map((it) => ({ ...it })));
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const upd = (i, patch) => setList(list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const del = (i) => setList(list.filter((_, j) => j !== i));
  const add = () => setList([...list, { descricao: "", valorUnitario: 0 }]);

  const salvar = async () => {
    setBusy(true);
    try {
      const clean = list
        .map((it) => ({ descricao: String(it.descricao || "").trim(), valorUnitario: Math.max(0, Math.round(Number(it.valorUnitario) || 0)) }))
        .filter((it) => it.descricao);
      const r = await api.put("/api/admin/itens-padrao", { itens: clean });
      toast(t("pr.defaults_saved"), { tone: "ok" });
      onSaved(r.itens || clean);
    } catch {
      toast(t("pr.save_fail"), { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("pr.defaults_title")}
      subtitle={t("pr.defaults_sub")}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("pr.cancel")}</Button>
        <Button variant="primary" loading={busy} onClick={salvar}>{t("pr.save_catalog")}</Button>
      </>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
        {list.length === 0 && (
          <p style={{ fontSize: "var(--t-sm)", color: "var(--ink-mute)" }}>
            {t("pr.defaults_empty")}
          </p>
        )}
        {list.map((it, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 110px 32px", gap: "var(--s-2)" }}>
            <input className="ui-input" placeholder={t("pr.default_desc_ph")} value={it.descricao}
              onChange={(e) => upd(i, { descricao: e.target.value })} />
            <input className="ui-input tnum" type="number" min="0" placeholder={simbolo(lang)} value={it.valorUnitario}
              onChange={(e) => upd(i, { valorUnitario: e.target.value })} />
            <button className="icon-btn" title={t("pr.remove")} onClick={() => del(i)}><Icon name="close" size={14} /></button>
          </div>
        ))}
        <div>
          <Button variant="secondary" size="sm" icon="plus" onClick={add}>{t("pr.add_item")}</Button>
        </div>
      </div>
    </Modal>
  );
}
