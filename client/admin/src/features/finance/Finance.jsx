import { useState, useEffect, useMemo } from "react";
import { api } from "../../api/client.js";
import { Icon } from "../../components/Icon.jsx";
import { Header, Badge, Field, Modal } from "../../components/shared.jsx";
import { useT, localeOf } from "../../i18n/index.jsx";
import { dinheiro, simbolo } from "../../lib/regional.js";

/* ══════════════════════════════════════════════════════════════════
   FINANCE — fluxo de caixa interno da empresa
   Endpoints: GET/POST/PATCH/DEL /api/admin/finance
   Collection: nomade_finance
   ══════════════════════════════════════════════════════════════════ */

// valores gravados no servidor (não traduzir); o rótulo sai de CAT_KEY no render
const CAT = {
  entrada: ["Found", "SaaS", "Outros"],
  saida: ["Infra", "Marketing", "Ferramentas", "Impostos", "Pró-labore", "Outros"],
};

const CAT_COLOR = {
  Found: "#00A896",
  SaaS: "#0077B6",
  Infra: "#d4654a",
  Marketing: "#c8a040",
  Ferramentas: "#7a6ad8",
  Impostos: "#dc2626",
  "Pró-labore": "#059669",
  Outros: "#6b7280",
};

const CAT_KEY = {
  Found: "fi.cat.found",
  SaaS: "fi.cat.saas",
  Infra: "fi.cat.infra",
  Marketing: "fi.cat.marketing",
  Ferramentas: "fi.cat.tools",
  Impostos: "fi.cat.taxes",
  "Pró-labore": "fi.cat.prolabore",
  Outros: "fi.cat.other",
};
const catLabel = (t, c) => (CAT_KEY[c] ? t(CAT_KEY[c]) : c);

const METODOS = ["Pix", "Cartão", "Boleto", "Transferência", "Dinheiro"];
const METODO_KEY = {
  Pix: "fi.pay.pix",
  Cartão: "fi.pay.card",
  Boleto: "fi.pay.boleto",
  Transferência: "fi.pay.transfer",
  Dinheiro: "fi.pay.cash",
};
const metodoLabel = (t, m) => (METODO_KEY[m] ? t(METODO_KEY[m]) : m);
const tipoLabel = (t, tipo) => t(tipo === "entrada" ? "fi.type.entrada" : "fi.type.saida");

/* ── helpers ── */
const fmt = (v, lang) => dinheiro(v, lang, { currencyDisplay: "narrowSymbol" });
// só o número, sem o símbolo da moeda
const fmtBare = (v, lang) => new Intl.NumberFormat(localeOf(lang), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
const fmtDate = (s, lang) => new Date(s + "T00:00:00").toLocaleDateString(localeOf(lang), { day: "2-digit", month: "short" });
const monthKey = (s) => (s || "").slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
const thisMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const lastMonthKey = () => {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const last6Months = (lang) => {
  const arr = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    arr.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString(localeOf(lang), { month: "short" }).replace(".", ""),
    });
  }
  return arr;
};

/* ══════════════════════════════════
   ROOT
   ══════════════════════════════════ */
export function Finance() {
  const { t } = useT();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState("dashboard");
  const [modal, setModal] = useState(null); // null | "new" | entry object

  const load = () => {
    setLoading(true);
    return api.get("/api/admin/finance")
      .then((r) => { setList(r || []); setLoading(false); })
      .catch(() => { setList([]); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const save = async (data) => {
    if (modal === "new") await api.post("/api/admin/finance", data);
    else await api.patch(`/api/admin/finance/${modal._id}`, data);
    setModal(null);
    load();
  };
  const del = async (id) => {
    if (!confirm(t("fi.confirm_delete"))) return;
    await api.del(`/api/admin/finance/${id}`);
    load();
  };

  const subNav = [
    { id: "dashboard", label: t("fi.tab.dashboard") },
    { id: "lancamentos", label: t("fi.tab.entries") },
    { id: "relatorios", label: t("fi.tab.reports") },
  ];

  return (
    <div>
      <Header
        title={t("fi.title")}
        subtitle={t("fi.subtitle")}
        action={
          <button className="btn-primary" onClick={() => setModal("new")}>
            <Icon name="plus" size={14} /> {t("fi.new_entry")}
          </button>
        }
      />

      {/* sub-nav */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, borderBottom: "1px solid var(--border)" }}>
        {subNav.map((s) => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            className="nav-btn"
            style={{
              width: "auto",
              padding: "8px 16px",
              marginBottom: -1,
              borderRadius: 0,
              borderBottom: sub === s.id ? "2px solid var(--blue)" : "2px solid transparent",
              color: sub === s.id ? "var(--blue)" : "var(--ink-mute)",
              fontWeight: sub === s.id ? 600 : 500,
              background: "transparent",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty-card">{t("fi.loading")}</div>
      ) : (
        <>
          {sub === "dashboard" && <FinanceDashboard list={list} />}
          {sub === "lancamentos" && <FinanceEntries list={list} onEdit={setModal} onDelete={del} onAdd={() => setModal("new")} />}
          {sub === "relatorios" && <FinanceReports list={list} />}
        </>
      )}

      {modal && (
        <EntryModal
          initial={modal === "new" ? null : modal}
          onClose={() => setModal(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════
   DASHBOARD
   ══════════════════════════════════ */
function FinanceDashboard({ list }) {
  const { t, lang } = useT();
  const s = useMemo(() => computeStats(list, lang), [list, lang]);

  const cards = [
    { label: t("fi.card.balance"), value: fmt(s.saldoMes, lang), color: s.saldoMes >= 0 ? "#00A896" : "#d4654a", hint: s.saldoMes >= 0 ? t("fi.card.in_black") : t("fi.card.in_red") },
    { label: t("fi.card.income"), value: fmt(s.entradasMes, lang), color: "#00A896", hint: t("fi.card.entries_hint", { n: s.entradasCount }) },
    { label: t("fi.card.expenses"), value: fmt(s.saidasMes, lang), color: "#d4654a", hint: t("fi.card.entries_hint", { n: s.saidasCount }) },
    { label: t("fi.card.mrr"), value: fmt(s.mrr, lang), color: "#0077B6", hint: t("fi.card.mrr_hint", { n: s.mrrCount }) },
    { label: t("fi.card.delta"), value: `${s.deltaPct >= 0 ? "+" : ""}${s.deltaPct.toFixed(1)}%`, color: s.deltaPct >= 0 ? "#00A896" : "#d4654a", hint: t("fi.card.delta_hint", { v: fmt(s.saldoMesAnt, lang) }) },
  ];

  return (
    <div>
      <div className="stats-grid">
        {cards.map((c, i) => (
          <div key={i} className="stat-card" style={{ "--accent": c.color }}>
            <div className="stat-label">{c.label}</div>
            <div className="stat-value" style={{ color: c.color, fontSize: 26 }}>{c.value}</div>
            <div className="stat-hint">{c.hint}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 32 }}>
        <h3 className="section-title">{t("fi.sec.evolution")}</h3>
        <div style={{ padding: "20px 24px", borderRadius: 14, background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
          <LineChart data={s.serie6m} />
        </div>
      </div>

      <div className="m-1col" style={{ marginTop: 32, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <h3 className="section-title">{t("fi.sec.expenses_by_cat")}</h3>
          <div style={{ padding: "20px 24px", borderRadius: 14, background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <Donut data={s.saidasPorCat} emptyLabel={t("fi.sec.no_expenses")} />
          </div>
        </div>
        <div>
          <h3 className="section-title">{t("fi.sec.income_by_source")}</h3>
          <div style={{ padding: "20px 24px", borderRadius: 14, background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <Donut data={s.entradasPorCat} emptyLabel={t("fi.sec.no_income")} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════
   LANÇAMENTOS
   ══════════════════════════════════ */
function FinanceEntries({ list, onEdit, onDelete, onAdd }) {
  const { t, lang } = useT();
  const [filter, setFilter] = useState({ tipo: "todos", cat: "todas", busca: "", periodo: "todos" });
  const allCats = [...CAT.entrada, ...CAT.saida];

  const filtered = useMemo(() => {
    return list
      .filter((e) => {
        if (filter.tipo !== "todos" && e.tipo !== filter.tipo) return false;
        if (filter.cat !== "todas" && e.categoria !== filter.cat) return false;
        if (filter.busca && !(e.descricao || "").toLowerCase().includes(filter.busca.toLowerCase())) return false;
        if (filter.periodo === "mes" && monthKey(e.data) !== thisMonthKey()) return false;
        if (filter.periodo === "mesAnt" && monthKey(e.data) !== lastMonthKey()) return false;
        return true;
      })
      .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  }, [list, filter]);

  const selectStyle = {
    background: "var(--bg-input)",
    border: "1px solid var(--border-strong)",
    color: "var(--ink)",
    padding: "8px 10px",
    borderRadius: 7,
    fontSize: 12,
    fontFamily: "var(--heading)",
    fontWeight: 500,
    cursor: "pointer",
  };

  return (
    <div>
      {/* filtros */}
      <div style={{
        display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center",
        padding: 14, background: "var(--bg-card)", borderRadius: 12,
        border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)", marginBottom: 16,
      }}>
        <select style={selectStyle} value={filter.periodo} onChange={(e) => setFilter({ ...filter, periodo: e.target.value })}>
          <option value="todos">{t("fi.filter.all_periods")}</option>
          <option value="mes">{t("fi.filter.this_month")}</option>
          <option value="mesAnt">{t("fi.filter.last_month")}</option>
        </select>
        <select style={selectStyle} value={filter.tipo} onChange={(e) => setFilter({ ...filter, tipo: e.target.value })}>
          <option value="todos">{t("fi.filter.all_types")}</option>
          <option value="entrada">{t("fi.card.income")}</option>
          <option value="saida">{t("fi.card.expenses")}</option>
        </select>
        <select style={selectStyle} value={filter.cat} onChange={(e) => setFilter({ ...filter, cat: e.target.value })}>
          <option value="todas">{t("fi.filter.all_cats")}</option>
          {allCats.map((c) => <option key={c} value={c}>{catLabel(t, c)}</option>)}
        </select>
        <input
          className="field-input"
          placeholder={t("fi.filter.search")}
          value={filter.busca}
          onChange={(e) => setFilter({ ...filter, busca: e.target.value })}
          style={{ flex: 1, minWidth: 180, marginBottom: 0 }}
        />
        <div style={{ fontSize: 11, color: "var(--ink-faint)", fontFamily: "var(--heading)" }}>
          {t("fi.filter.results", { n: filtered.length })}
        </div>
      </div>

      {/* tabela */}
      {filtered.length === 0 ? (
        <div className="empty-card">
          {t("fi.empty")}
          <div style={{ marginTop: 12 }}>
            <button className="btn-ghost" onClick={onAdd}>{t("fi.empty_cta")}</button>
          </div>
        </div>
      ) : (
        <div className="table">
          <div className="table-head">
            <div style={{ width: 90 }}>{t("fi.col.date")}</div>
            <div style={{ width: 80 }}>{t("fi.col.type")}</div>
            <div style={{ flex: 1 }}>{t("fi.col.category")}</div>
            <div style={{ flex: 2 }}>{t("fi.col.description")}</div>
            <div style={{ width: 130, textAlign: "right" }}>{t("fi.col.amount")}</div>
            <div style={{ width: 80 }}></div>
          </div>
          {filtered.map((e) => (
            <div key={e._id} className="table-row">
              <div style={{ width: 90, fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-soft)" }}>
                {fmtDate(e.data, lang)}
              </div>
              <div style={{ width: 80 }}>
                <Badge tone={e.tipo === "entrada" ? "teal" : "red"}>{tipoLabel(t, e.tipo)}</Badge>
              </div>
              <div style={{ flex: 1, fontSize: 12, color: "var(--ink-soft)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: CAT_COLOR[e.categoria] || "#6b7280" }} />
                  {catLabel(t, e.categoria)}
                </span>
                {e.recorrente && <div style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 2 }}>{t("fi.recurring_tag")}</div>}
              </div>
              <div style={{ flex: 2, fontSize: 13, color: "var(--ink)" }}>
                {e.descricao}
                {e.metodo && <div style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 2 }}>{metodoLabel(t, e.metodo)}</div>}
              </div>
              <div style={{
                width: 130, textAlign: "right", fontFamily: "var(--mono)", fontSize: 13,
                fontWeight: 600, color: e.tipo === "entrada" ? "#00A896" : "#d4654a",
              }}>
                {e.tipo === "entrada" ? "+" : "−"} {fmtBare(e.valor, lang)}
              </div>
              <div style={{ width: 80, display: "flex", gap: 4, justifyContent: "flex-end" }}>
                <button className="icon-btn" onClick={() => onEdit(e)}><Icon name="edit" size={14} /></button>
                <button className="icon-btn" onClick={() => onDelete(e._id)}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════
   RELATÓRIOS
   ══════════════════════════════════ */
function FinanceReports({ list }) {
  const { t, lang } = useT();
  const [mes, setMes] = useState(thisMonthKey());
  const rel = useMemo(() => computeReport(list, mes), [list, mes]);

  const mesesDisponiveis = useMemo(() => {
    const set = new Set(list.map((e) => monthKey(e.data)).filter(Boolean));
    const keys = Array.from(set).sort().reverse();
    if (!keys.includes(thisMonthKey())) keys.unshift(thisMonthKey());
    return keys.map((k) => ({
      v: k,
      l: new Date(k + "-01T00:00:00").toLocaleDateString(localeOf(lang), { month: "long", year: "numeric" }),
    }));
  }, [list, lang]);

  const exportCSV = () => {
    const rows = list.filter((e) => monthKey(e.data) === mes).sort((a, b) => (a.data || "").localeCompare(b.data || ""));
    const header = "data,tipo,categoria,descricao,valor,metodo,recorrente\n";
    const body = rows
      .map((e) => [e.data, e.tipo, e.categoria, `"${(e.descricao || "").replace(/"/g, '""')}"`, e.valor, e.metodo || "", e.recorrente ? "sim" : "nao"].join(","))
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finance-${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <select
          value={mes}
          onChange={(e) => setMes(e.target.value)}
          style={{
            background: "var(--bg-input)", border: "1px solid var(--border-strong)", color: "var(--ink)",
            padding: "9px 14px", borderRadius: 7, fontSize: 13, fontFamily: "var(--heading)",
            fontWeight: 600, cursor: "pointer", textTransform: "capitalize",
          }}
        >
          {mesesDisponiveis.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
        </select>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-ghost" onClick={exportCSV}>{t("fi.rep.export_csv")}</button>
          <button className="btn-ghost" onClick={() => window.print()}>{t("fi.rep.print")}</button>
        </div>
      </div>

      {/* DRE */}
      <h3 className="section-title">{t("fi.rep.statement")}</h3>
      <div style={{ padding: "20px 24px", borderRadius: 14, background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
        <DreRow label={t("fi.rep.total_revenue")} value={rel.receita} bold color="#00A896" />
        {rel.receitaPorCat.map((r) => <DreRow key={r.label} label={`      ${catLabel(t, r.label)}`} value={r.value} muted />)}

        <div style={{ height: 1, background: "var(--border)", margin: "10px 0" }} />

        <DreRow label={t("fi.rep.total_expenses")} value={-rel.despesa} bold color="#d4654a" />
        {rel.despesaPorCat.map((r) => <DreRow key={r.label} label={`      ${catLabel(t, r.label)}`} value={-r.value} muted />)}

        <div style={{ height: 1, background: "var(--border-strong)", margin: "14px 0" }} />

        <DreRow label={t("fi.rep.net_result")} value={rel.resultado} bold big color={rel.resultado >= 0 ? "#00A896" : "#d4654a"} />

        {rel.receita > 0 && (
          <div style={{ marginTop: 14, fontSize: 11, color: "var(--ink-faint)", fontFamily: "var(--heading)" }}>
            {t("fi.rep.margin", { pct: ((rel.resultado / rel.receita) * 100).toFixed(1), v: fmt(rel.recorrentes, lang) })}
          </div>
        )}
      </div>

      <div className="m-1col" style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <h3 className="section-title">{t("fi.rep.revenue_by_source")}</h3>
          <div style={{ padding: "18px 22px", borderRadius: 14, background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <Bars data={rel.receitaPorCat} total={rel.receita} color="#00A896" />
          </div>
        </div>
        <div>
          <h3 className="section-title">{t("fi.rep.expense_by_cat")}</h3>
          <div style={{ padding: "18px 22px", borderRadius: 14, background: "var(--bg-card)", border: "1px solid var(--border)", boxShadow: "var(--shadow-sm)" }}>
            <Bars data={rel.despesaPorCat} total={rel.despesa} color="#d4654a" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DreRow({ label, value, bold, muted, big, color }) {
  const { lang } = useT();
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", padding: "6px 0",
      fontSize: big ? 16 : 13, fontWeight: bold ? 600 : 400,
      fontFamily: bold ? "var(--heading)" : "var(--body)",
      color: muted ? "var(--ink-mute)" : "var(--ink)",
      whiteSpace: "pre",
    }}>
      <span>{label}</span>
      <span style={{ fontFamily: "var(--mono)", color: color || "inherit", fontWeight: bold ? 600 : 500 }}>
        {fmt(value, lang)}
      </span>
    </div>
  );
}

/* ══════════════════════════════════
   ENTRY MODAL
   ══════════════════════════════════ */
function EntryModal({ initial, onClose, onSave }) {
  const { t, lang } = useT();
  const [f, setF] = useState(initial || {
    tipo: "saida", categoria: "Infra", descricao: "", valor: "",
    data: today(), metodo: "Cartão", recorrente: false,
  });

  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }));
  const cats = CAT[f.tipo];

  const submit = () => {
    if (!f.descricao.trim()) return alert(t("fi.form.err_description"));
    const val = Number(f.valor);
    if (!val || val <= 0) return alert(t("fi.form.err_amount"));
    onSave({ ...f, valor: val });
  };

  return (
    <Modal title={initial ? t("fi.form.edit_title") : t("fi.new_entry")} onClose={onClose}>
      {/* tipo toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["entrada", "saida"].map((tp) => (
          <button
            key={tp}
            onClick={() => { set("tipo", tp); set("categoria", CAT[tp][0]); }}
            style={{
              flex: 1, padding: "10px", borderRadius: 8,
              background: f.tipo === tp ? (tp === "entrada" ? "#00A896" : "#d4654a") : "transparent",
              color: f.tipo === tp ? "var(--bg-elev)" : "var(--ink-mute)",
              border: `1px solid ${f.tipo === tp ? "transparent" : "var(--border-strong)"}`,
              fontFamily: "var(--heading)", fontWeight: 600, fontSize: 12,
              textTransform: "capitalize", cursor: "pointer",
            }}
          >
            {tipoLabel(t, tp)}
          </button>
        ))}
      </div>

      <Field label={t("fi.form.description")} value={f.descricao} onChange={(v) => set("descricao", v)} placeholder={t("fi.form.description_ph")} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label={t("fi.form.amount", { cur: simbolo(lang) })} type="number" value={f.valor} onChange={(v) => set("valor", v)} placeholder={t("fi.form.amount_ph")} />
        <Field label={t("fi.col.date")} type="date" value={f.data} onChange={(v) => set("data", v)} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ marginBottom: 14 }}>
          <label className="field-label">{t("fi.col.category")}</label>
          <select className="field-input" value={f.categoria} onChange={(e) => set("categoria", e.target.value)}>
            {cats.map((c) => <option key={c} value={c}>{catLabel(t, c)}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label className="field-label">{t("fi.form.method")}</label>
          <select className="field-input" value={f.metodo} onChange={(e) => set("metodo", e.target.value)}>
            {METODOS.map((m) => <option key={m} value={m}>{metodoLabel(t, m)}</option>)}
          </select>
        </div>
      </div>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--ink-mute)", cursor: "pointer", marginBottom: 4, lineHeight: 1.45 }}>
        <input
          type="checkbox"
          checked={!!f.recorrente}
          onChange={(e) => set("recorrente", e.target.checked)}
          style={{ marginTop: 2 }}
        />
        <span>
          <strong style={{ color: "var(--ink)" }}>{t("fi.form.recurring")}</strong> — {t("fi.form.recurring_help")}
          {f.recorrente && (
            <span style={{ display: "block", marginTop: 4, color: "#0077B6" }}>
              {t("fi.form.recurring_on", { d: f.data })}
            </span>
          )}
        </span>
      </label>

      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>{t("fi.form.cancel")}</button>
        <button className="btn-primary" onClick={submit} disabled={!f.descricao || !f.valor}>
          {initial ? t("fi.form.save") : t("fi.form.add")}
        </button>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════════
   CHARTS
   ══════════════════════════════════ */
function LineChart({ data }) {
  const { t } = useT();
  const W = 900, H = 240, pad = { t: 20, r: 20, b: 28, l: 50 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const max = Math.max(1, ...data.flatMap((d) => [d.entrada, d.saida]));
  const step = iw / (data.length - 1 || 1);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const pathE = data.map((d, i) => `${i === 0 ? "M" : "L"} ${pad.l + i * step} ${y(d.entrada)}`).join(" ");
  const pathS = data.map((d, i) => `${i === 0 ? "M" : "L"} ${pad.l + i * step} ${y(d.saida)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {[0, 1, 2, 3, 4].map((i) => {
          const gy = pad.t + (ih / 4) * i, val = max - (max / 4) * i;
          return (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={gy} y2={gy} stroke="var(--border)" />
              <text x={pad.l - 6} y={gy + 4} fill="var(--ink-faint)" fontSize="10" textAnchor="end" fontFamily="JetBrains Mono, monospace">
                {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val.toFixed(0)}
              </text>
            </g>
          );
        })}
        <path d={`${pathE} L ${pad.l + (data.length - 1) * step} ${pad.t + ih} L ${pad.l} ${pad.t + ih} Z`} fill="#00A896" opacity="0.08" />
        <path d={pathE} fill="none" stroke="#00A896" strokeWidth="2" />
        <path d={pathS} fill="none" stroke="#d4654a" strokeWidth="2" strokeDasharray="5 3" />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={pad.l + i * step} cy={y(d.entrada)} r="3" fill="#00A896" />
            <circle cx={pad.l + i * step} cy={y(d.saida)} r="3" fill="#d4654a" />
            <text x={pad.l + i * step} y={H - 8} fill="var(--ink-mute)" fontSize="11" textAnchor="middle" fontFamily="Bricolage Grotesque, serif" fontWeight="500">
              {d.label}
            </text>
          </g>
        ))}
      </svg>
      <div style={{ display: "flex", gap: 20, marginTop: 8, fontSize: 11, color: "var(--ink-mute)", fontFamily: "var(--heading)" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 18, height: 2, background: "#00A896" }} /> {t("fi.card.income")}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 18, height: 2, backgroundImage: "repeating-linear-gradient(90deg, #d4654a 0 4px, transparent 4px 7px)" }} /> {t("fi.card.expenses")}
        </span>
      </div>
    </div>
  );
}

function Donut({ data, emptyLabel }) {
  const { t, lang } = useT();
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div style={{ color: "var(--ink-faint)", fontSize: 13, padding: "16px 0" }}>{emptyLabel}</div>;

  const W = 150, cx = W / 2, cy = W / 2, r = 58, rInner = 40;
  let acc = 0;
  const arcs = data.map((d) => {
    const start = (acc / total) * Math.PI * 2; acc += d.value;
    const end = (acc / total) * Math.PI * 2;
    return { ...d, start, end };
  });
  const arcPath = (start, end) => {
    const x1 = cx + r * Math.cos(start - Math.PI / 2), y1 = cy + r * Math.sin(start - Math.PI / 2);
    const x2 = cx + r * Math.cos(end - Math.PI / 2), y2 = cy + r * Math.sin(end - Math.PI / 2);
    const xi2 = cx + rInner * Math.cos(end - Math.PI / 2), yi2 = cy + rInner * Math.sin(end - Math.PI / 2);
    const xi1 = cx + rInner * Math.cos(start - Math.PI / 2), yi1 = cy + rInner * Math.sin(start - Math.PI / 2);
    const large = end - start > Math.PI ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${rInner} ${rInner} 0 ${large} 0 ${xi1} ${yi1} Z`;
  };

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
      <svg viewBox={`0 0 ${W} ${W}`} width={W} height={W} style={{ flexShrink: 0 }}>
        {arcs.map((a, i) => <path key={i} d={arcPath(a.start, a.end)} fill={CAT_COLOR[a.label] || "#6b7280"} />)}
        <text x={cx} y={cy - 2} textAnchor="middle" fill="var(--ink)" fontFamily="Bricolage Grotesque, serif" fontSize="14" fontWeight="700">
          {fmtBare(total, lang)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="var(--ink-mute)" fontSize="9" fontFamily="Bricolage Grotesque, serif">{t("fi.chart.total")}</text>
      </svg>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        {arcs.map((a, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: 2, background: CAT_COLOR[a.label] || "#6b7280" }} />
              <span style={{ fontFamily: "var(--heading)", fontWeight: 500 }}>{catLabel(t, a.label)}</span>
            </span>
            <span style={{ fontFamily: "var(--mono)", color: "var(--ink-soft)" }}>
              {fmt(a.value, lang)} <span style={{ color: "var(--ink-faint)", fontSize: 10 }}>· {((a.value / total) * 100).toFixed(0)}%</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Bars({ data, total, color }) {
  const { t, lang } = useT();
  if (data.length === 0 || total === 0) return <div style={{ color: "var(--ink-faint)", fontSize: 13 }}>{t("fi.chart.no_data")}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data.map((d) => {
        const pct = (d.value / total) * 100;
        return (
          <div key={d.label}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
              <span style={{ fontFamily: "var(--heading)", fontWeight: 500 }}>{catLabel(t, d.label)}</span>
              <span style={{ fontFamily: "var(--mono)", color: "var(--ink-soft)" }}>
                {fmt(d.value, lang)} <span style={{ color: "var(--ink-faint)" }}>· {pct.toFixed(0)}%</span>
              </span>
            </div>
            <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════
   STATS & REPORT
   ══════════════════════════════════ */

/**
 * Retorna as entradas que "existem" num determinado mês:
 *   - Entradas não-recorrentes cujo data cai dentro do mês
 *   - Entradas recorrentes cuja data original é <= esse mês
 *     (a recorrência se projeta indefinidamente a partir do mês de origem)
 *
 * Se o user quiser parar uma recorrência, edita o registro pra
 * recorrente=false (vira só lançamento único) ou deleta.
 */
function entriesInMonth(list, mes) {
  return list.filter((e) => {
    const mk = monthKey(e.data);
    if (e.recorrente) return mk <= mes; // recorrente: aparece nesse mês e todos os seguintes
    return mk === mes;                   // único: só no mês original
  });
}

function computeStats(list, lang) {
  const m = thisMonthKey(), mAnt = lastMonthKey();
  const mesEntries = entriesInMonth(list, m);
  const mesAntEntries = entriesInMonth(list, mAnt);
  const sum = (arr, tipo) => arr.filter((e) => e.tipo === tipo).reduce((s, e) => s + (Number(e.valor) || 0), 0);

  const entradasMes = sum(mesEntries, "entrada"), saidasMes = sum(mesEntries, "saida");
  const saldoMes = entradasMes - saidasMes;
  const saldoMesAnt = sum(mesAntEntries, "entrada") - sum(mesAntEntries, "saida");
  const deltaPct = saldoMesAnt === 0 ? (saldoMes === 0 ? 0 : 100) : ((saldoMes - saldoMesAnt) / Math.abs(saldoMesAnt)) * 100;

  const serie6m = last6Months(lang).map(({ key, label }) => {
    const bucket = entriesInMonth(list, key);
    return { label, entrada: sum(bucket, "entrada"), saida: sum(bucket, "saida") };
  });

  const groupBy = (arr, tipo) => {
    const map = {};
    arr.filter((e) => e.tipo === tipo).forEach((e) => {
      map[e.categoria] = (map[e.categoria] || 0) + (Number(e.valor) || 0);
    });
    return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };

  // MRR — soma das entradas RECORRENTES de receita ativas no mês atual
  const mrrEntradas = mesEntries.filter(e => e.tipo === "entrada" && e.recorrente);
  const mrr = mrrEntradas.reduce((s, e) => s + (Number(e.valor) || 0), 0);

  return {
    saldoMes, entradasMes, saidasMes,
    entradasCount: mesEntries.filter((e) => e.tipo === "entrada").length,
    saidasCount: mesEntries.filter((e) => e.tipo === "saida").length,
    deltaPct, saldoMesAnt, serie6m,
    saidasPorCat: groupBy(mesEntries, "saida"),
    entradasPorCat: groupBy(mesEntries, "entrada"),
    mrr,
    mrrCount: mrrEntradas.length,
  };
}

function computeReport(list, mes) {
  const bucket = entriesInMonth(list, mes);
  const receita = bucket.filter((e) => e.tipo === "entrada").reduce((s, e) => s + (Number(e.valor) || 0), 0);
  const despesa = bucket.filter((e) => e.tipo === "saida").reduce((s, e) => s + (Number(e.valor) || 0), 0);
  const group = (tipo) => {
    const map = {};
    bucket.filter((e) => e.tipo === tipo).forEach((e) => {
      map[e.categoria] = (map[e.categoria] || 0) + (Number(e.valor) || 0);
    });
    return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };
  const recorrentes = bucket.filter((e) => e.recorrente).reduce((s, e) => s + (Number(e.valor) || 0), 0);
  return {
    receita, despesa, resultado: receita - despesa,
    receitaPorCat: group("entrada"), despesaPorCat: group("saida"), recorrentes,
  };
}
