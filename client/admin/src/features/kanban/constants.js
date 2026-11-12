/* ══════════════════════════════════════════════════════════
   KANBAN — constantes
   Labels ficam como chave i18n (labelKey / nameKey): quem
   renderiza chama t(key).
   ══════════════════════════════════════════════════════════ */

export const PRIORITIES = [
  { id: "urgent", labelKey: "kb.pri.urgent", color: "#dc2626", icon: "↑↑" },
  { id: "high",   labelKey: "kb.pri.high",   color: "#d4654a", icon: "↑" },
  { id: "medium", labelKey: "kb.pri.medium", color: "#c8a040", icon: "—" },
  { id: "low",    labelKey: "kb.pri.low",    color: "#6b7280", icon: "↓" },
];

export const LABEL_COLORS = [
  { id: "blue",   bg: "#dbeafe", fg: "#1d4ed8" },
  { id: "green",  bg: "#d1fae5", fg: "#047857" },
  { id: "orange", bg: "#ffedd5", fg: "#c2410c" },
  { id: "pink",   bg: "#fce7f3", fg: "#be185d" },
  { id: "purple", bg: "#ede9fe", fg: "#6d28d9" },
  { id: "teal",   bg: "#ccfbf1", fg: "#0f766e" },
  { id: "red",    bg: "#fee2e2", fg: "#b91c1c" },
  { id: "gray",   bg: "#f3f4f6", fg: "#374151" },
];

export const DEFAULT_COLUMNS = [
  { id: "backlog", nameKey: "kb.col.backlog", color: "#6b7280", position: 0 },
  { id: "todo",    nameKey: "kb.col.todo",    color: "#8b5cf6", position: 1 },
  { id: "doing",   nameKey: "kb.col.doing",   color: "#0077B6", position: 2 },
  { id: "review",  nameKey: "kb.col.review",  color: "#c8a040", position: 3 },
  { id: "done",    nameKey: "kb.col.done",    color: "#00A896", position: 4 },
];

/* PRIORITIES com `label` resolvido no idioma ativo (pra KBSelect etc.) */
export const prioritiesT = (t) => PRIORITIES.map(p => ({ ...p, label: t(p.labelKey) }));
/* DEFAULT_COLUMNS com `name` resolvido no idioma ativo */
export const defaultColumnsT = (t) => DEFAULT_COLUMNS.map(c => ({ ...c, name: t(c.nameKey) }));

export const uid = () => Math.random().toString(36).slice(2, 10);
