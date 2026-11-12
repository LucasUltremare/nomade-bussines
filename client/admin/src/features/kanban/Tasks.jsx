import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client.js";
import { getSocket } from "../../lib/socket.js";
import { ehSocio } from "../../lib/acesso.js";
import { memberByEmail } from "../../lib/team.js";
import { Icon } from "../../components/Icon.jsx";
import { Avatar } from "../../components/Avatar.jsx";
import { useFloating } from "../../hooks/useFloating.js";
import { NotifBell } from "../overview/NotifBell.jsx";
import { useT } from "../../i18n/index.jsx";

import { prioritiesT, LABEL_COLORS, defaultColumnsT, uid } from "./constants.js";
import { KBSelect } from "./components/KBSelect.jsx";
import { MemberPicker } from "./components/MemberPicker.jsx";
import { KBDialog } from "./components/KBDialog.jsx";
import { KanbanColumn } from "./components/KanbanColumn.jsx";
import { TaskDetail } from "./components/TaskDetail.jsx";
import { ListView } from "./components/ListView.jsx";
import { ColumnEditModal } from "./components/ColumnEditModal.jsx";
import { TemplateModal } from "./components/TemplateModal.jsx";
import { MoveTaskSheet } from "./components/MoveTaskSheet.jsx";

/* ══════════════════════════════════════════════════════════
   TASKS — main kanban (tempo real via Socket.IO)
   ══════════════════════════════════════════════════════════ */

export function Tasks({ user, me, openTaskRequest, onOpenTask, clientId, openClientBoard, onTaskRequestDone, onClientBoardDone }) {
  const { t } = useT();
  const [boards, setBoards] = useState([]);
  const [activeBoard, setActiveBoard] = useState(null);
  // Escopo do seletor: boards internos vs board de cada cliente
  const [scope, setScope] = useState(() => {
    try { return localStorage.getItem("kb:scope") || "interno"; } catch { return "interno"; }
  });
  const [clients, setClients] = useState([]);
  // Ref pro board ativo: loadBoards precisa saber se o ativo é de cliente
  // sem virar dependência (senão vira loop de fetch).
  const activeBoardRef = useRef(null);
  const [tasks, setTasks] = useState([]);
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(null);
  /* seleção múltipla: limpar várias tasks sem abrir uma por uma */
  const [sel, setSel] = useState(() => new Set());
  const toggleSel = (id) => setSel(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  // Mobile sempre começa em list — board é inviável em viewport pequena
  const [viewMode, setViewMode] = useState(() => (typeof window !== "undefined" && window.innerWidth < 768) ? "list" : "board");

  // Reage a resize: se entrar em mobile, força list; ao sair, mantém o que user escolheu
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 768) setViewMode("list");
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [filters, setFilters] = useState({ assignee: "", priority: "", label: "", search: "" });
  const [showFilters, setShowFilters] = useState(false);
  const boardMenuFloat = useFloating({ align: "right" });
  const clientPickerFloat = useFloating({ align: "left" });
  const [clientSearch, setClientSearch] = useState("");
  const [editingCol, setEditingCol] = useState(null);
  const [tplModal, setTplModal] = useState(null); // "create" | "switch"
  const [dragState, setDragState] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [moveTask, setMoveTask] = useState(null);
  const [colDragging, setColDragging] = useState(null);
  const [colDropTarget, setColDropTarget] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const boardScrollRef = useRef(null);

  /* Pedir execução em lote. A web não roda nada — marca o pedido e o runner
     pega. Volta dizendo o que ficou de fora e por quê: 12 de 15 sem explicação
     é pior que um erro na cara. */
  const [loteMsg, setLoteMsg] = useState("");
  const pedirLote = async (corpo) => {
    setLoteMsg("");
    try {
      const r = await fetch("/api/office/fila/pedir", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}` },
        body: JSON.stringify(corpo),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || t("kb.err.request"));
      setSel(new Set());
      const fora = (d.ignoradas || []).length
        ? t("kb.batch.skipped", { n: d.ignoradas.length, reasons: [...new Set(d.ignoradas.map(i => i.motivo))].join(", ") })
        : "";
      setLoteMsg(d.pedidas ? t(d.pedidas > 1 ? "kb.batch.requestedN" : "kb.batch.requested1", { n: d.pedidas, extra: fora }) : t("kb.batch.none", { extra: fora }));
      if (activeBoard) loadTasks(activeBoard._id, showArchived);
    } catch (e) {
      setLoteMsg(e.message);
    }
  };

  const cancelarLote = async (corpo) => {
    setLoteMsg("");
    try {
      const r = await fetch("/api/office/fila/cancelar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}` },
        body: JSON.stringify(corpo),
      });
      const d = await r.json();
      setLoteMsg(t("kb.batch.cancelled", { n: d.canceladas || 0 }));
      if (activeBoard) loadTasks(activeBoard._id, showArchived);
    } catch (e) { setLoteMsg(e.message); }
  };

  /* ─── PASTA NO RUNNER ───────────────────────────────────────────────────
     O runner recusa board sem pasta (`soltar('o board não tem pasta
     configurada no runner')`) e a task volta ao estado anterior — no admin
     isso aparece como board verde e fila parada, sem nenhuma pista. O campo
     existia só no CLI (`nomade pastas`), o que tirava o kanban do fluxo:
     você pede execução aqui e descobre no terminal por que não rodou.
     A API já existia; o que faltava era ela chegar na tela. */
  const [pastasRunner, setPastasRunner] = useState({});
  const [maquinas, setMaquinas] = useState([]);
  const loadPastas = useCallback(async () => {
    const h = { Authorization: `Bearer ${api.token()}` };
    try {
      // runner-boards, não "boards": é a rota que existe e a única que traz a pasta
      const r = await fetch("/api/office/runner-boards", { headers: h });
      if (r.ok) {
        const rows = await r.json();
        setPastasRunner(Object.fromEntries(rows.map(b => [String(b.id), { pasta: b.pasta || null, maquinaId: b.maquinaId || null }])));
      }
    } catch { /* aviso é informativo: falhar aqui não pode derrubar o kanban */ }
    try {
      const r = await fetch("/api/office/runners", { headers: h });
      if (r.ok) setMaquinas(await r.json());
    } catch { /* idem */ }
  }, []);
  useEffect(() => { loadPastas(); }, [loadPastas]);

  const cfgBoard = activeBoard ? pastasRunner[String(activeBoard._id)] || {} : {};
  const pastaDoBoard = cfgBoard.pasta || null;
  const maquinaDoBoard = cfgBoard.maquinaId || null;
  // execução por agent é do escritório (só sócios): membro não vê os controles de runner
  const temTaskDeAgent = ehSocio() && tasks.some(t => String(t.assignee || "").startsWith("agent:"));
  const semPastaRunner = temTaskDeAgent && !pastaDoBoard;

  const editarPastaRunner = async () => {
    if (!activeBoard) return;
    const nova = window.prompt(t("kb.folder.prompt"), pastaDoBoard || "");
    if (nova === null) return;
    try {
      const r = await fetch(`/api/office/boards/${activeBoard._id}/pasta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}` },
        body: JSON.stringify({ pasta: nova.trim() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || t("kb.err.save"));
      await loadPastas();
      setLoteMsg(nova.trim() ? t("kb.folder.set", { path: nova.trim() }) : t("kb.folder.removed"));
    } catch (e) { setLoteMsg(e.message); }
  };

  /* Em qual MÁQUINA este board roda. Manda a pasta atual junto de propósito: a
     rota grava `pastaNoRunner` a partir do corpo, então um PATCH só com a
     máquina apagaria o caminho. */
  const salvarMaquinaBoard = async (maquinaId) => {
    if (!activeBoard) return;
    try {
      const r = await fetch(`/api/office/boards/${activeBoard._id}/pasta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${api.token()}` },
        body: JSON.stringify({ pasta: pastaDoBoard || "", maquinaId: maquinaId || "" }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error || t("kb.err.save"));
      await loadPastas();
      const m = maquinas.find(x => x.machineId === maquinaId);
      setLoteMsg(maquinaId ? t("kb.machine.pinned", { name: m?.nome || maquinaId }) : t("kb.machine.any_set"));
    } catch (e) { setLoteMsg(e.message); }
  };

  /* ─── Carrega boards e tasks ─── */
  useEffect(() => { activeBoardRef.current = activeBoard; }, [activeBoard]);

  const loadBoards = useCallback(async () => {
    try {
      // Embutido num cliente: um board só (cria se não existe), sem seletor
      if (clientId) {
        const board = await api.get(`/api/admin/clients/${clientId}/board`);
        setBoards([board]);
        setActiveBoard(board);
        return;
      }
      const l = await api.get("/api/admin/boards");
      setBoards(l);
      // Board de cliente não está na lista interna — recarrega ele mesmo em vez
      // de cair pro primeiro board interno (senão editar coluna te expulsava).
      const cur = activeBoardRef.current;
      if (cur?.clientId) {
        try { setActiveBoard(await api.get(`/api/admin/clients/${cur.clientId}/board`)); } catch { /* mantém */ }
        return;
      }
      setActiveBoard(prev => {
        if (!prev && l.length > 0) return l[0];
        if (prev) {
          const u = l.find(b => b._id === prev._id);
          return u || l[0] || null;
        }
        return prev;
      });
    } catch { setBoards([]); }
  }, [clientId]);

  /* ─── Clientes (pro seletor) + escolha do board de cliente ─── */
  useEffect(() => {
    if (clientId) return;
    api.get("/api/admin/clients").then(setClients).catch(() => setClients([]));
  }, [clientId]);

  useEffect(() => {
    if (clientId) return;
    try { localStorage.setItem("kb:scope", scope); } catch { /* ignora */ }
  }, [scope, clientId]);

  const selectClientBoard = useCallback(async (cid) => {
    try {
      const board = await api.get(`/api/admin/clients/${cid}/board`);
      setActiveBoard(board);
      try { localStorage.setItem("kb:lastClient", String(cid)); } catch { /* ignora */ }
    } catch { /* ignora */ }
  }, []);

  const pickClient = useCallback((list) => {
    let last = null;
    try { last = localStorage.getItem("kb:lastClient"); } catch { /* ignora */ }
    return list.find(c => String(c._id) === last) || list[0] || null;
  }, []);

  // Restaura o board de cliente ao recarregar a página com escopo "clientes"
  const restored = useRef(false);
  useEffect(() => {
    if (clientId || restored.current || scope !== "clientes" || clients.length === 0) return;
    restored.current = true;
    const t = pickClient(clients);
    if (t) selectClientBoard(t._id);
  }, [clientId, scope, clients, pickClient, selectClientBoard]);

  const switchScope = (s) => {
    setScope(s);
    if (s === "clientes") {
      if (!activeBoardRef.current?.clientId) {
        const t = pickClient(clients);
        if (t) selectClientBoard(t._id);
      }
    } else if (activeBoardRef.current?.clientId) {
      setActiveBoard(boards[0] || null);
    }
  };

  // Pedido externo (botão no cliente) → abre o board dele aqui.
  // onClientBoardDone limpa o pedido no Dashboard: sem isso, cada volta pra aba
  // Kanban remontava o componente e o pedido velho sequestrava o escopo.
  useEffect(() => {
    if (clientId || !openClientBoard?.clientId) return;
    setScope("clientes");
    restored.current = true;
    selectClientBoard(openClientBoard.clientId).finally(() => onClientBoardDone?.());
  }, [openClientBoard?.nonce]);

  // Versiona os fetches: trocar de board rápido podia renderizar as tasks de um
  // board dentro de outro (resposta lenta chegando depois).
  const tasksReq = useRef(0);
  const loadTasks = useCallback(async (boardId, archived = false) => {
    if (!boardId) { setTasks([]); return; }
    const myReq = ++tasksReq.current;
    try {
      const archivedParam = archived ? "&archived=true" : "";
      const list = await api.get(`/api/admin/tasks?boardId=${boardId}${archivedParam}`);
      if (myReq === tasksReq.current) setTasks(list);
    } catch { if (myReq === tasksReq.current) setTasks([]); }
  }, []);

  useEffect(() => { loadBoards(); }, [loadBoards]);
  useEffect(() => { if (activeBoard) loadTasks(activeBoard._id, showArchived); }, [activeBoard?._id, loadTasks, showArchived]);

  /* ─── Abrir task vinda de notificação ─── */
  useEffect(() => {
    if (!openTaskRequest?.taskId) return;
    const { taskId, boardId } = openTaskRequest;
    // Se o board da task é diferente do ativo, troca
    if (boardId && activeBoard?._id !== boardId) {
      const targetBoard = boards.find(b => b._id === boardId);
      if (targetBoard) {
        setScope("interno"); // escopo "clientes" persistido esconderia o board atrás do empty state
        setActiveBoard(targetBoard);
        return; // espera o loadTasks acabar, outro tick resolverá
      }
      // Não está entre os internos → board de CLIENTE ou a Área Dev (a lista
      // /boards só traz internos). Busca por id, senão o clique morria.
      api.get(`/api/admin/boards/${boardId}`)
        .then(b => {
          if (!b?._id) return;
          setScope(b.clientId ? "clientes" : "interno");
          setActiveBoard(b);
        })
        .catch(() => { /* board sumiu: ignora */ });
      return;
    }
    // Board certo — procura a task e abre
    const task = tasks.find(t => t._id === taskId);
    if (task) {
      setDetail(task);
      const sock = getSocket();
      if (sock) sock.emit("task:viewing", task._id);
      onTaskRequestDone?.(); // consome: senão reabre o detail fechado e trava a troca de board
    }
    // Se não achou a task ainda (tasks ainda carregando), o próximo render vai pegar
  }, [openTaskRequest?.nonce, activeBoard?._id, tasks, boards]);

  /* ─── Socket.IO: entra/sai do board, escuta eventos ─── */
  useEffect(() => {
    const sock = getSocket();
    if (!sock || !activeBoard) return;

    sock.emit("board:join", activeBoard._id);

    const onTaskCreated = (task) => {
      setTasks(prev => prev.find(t => t._id === task._id) ? prev : [...prev, task]);
    };
    const onTaskUpdated = (task) => {
      setTasks(prev => prev.map(t => t._id === task._id ? task : t));
      setDetail(prev => prev && prev._id === task._id ? task : prev);
    };
    const onTaskDeleted = ({ taskId }) => {
      setTasks(prev => prev.filter(t => t._id !== taskId));
      setDetail(prev => prev && prev._id === taskId ? null : prev);
    };
    const onTasksReordered = () => loadTasks(activeBoard._id, showArchived);
    const onBoardUpdated = () => loadBoards();

    sock.on("task:created", onTaskCreated);
    sock.on("task:updated", onTaskUpdated);
    sock.on("task:deleted", onTaskDeleted);
    sock.on("tasks:reordered", onTasksReordered);
    sock.on("board:updated", onBoardUpdated);

    return () => {
      sock.off("task:created", onTaskCreated);
      sock.off("task:updated", onTaskUpdated);
      sock.off("task:deleted", onTaskDeleted);
      sock.off("tasks:reordered", onTasksReordered);
      sock.off("board:updated", onBoardUpdated);
      sock.emit("task:viewing", null); // senão a presença "vendo task" fica pendurada ao trocar de aba
      sock.emit("board:leave");
    };
  }, [activeBoard?._id, loadTasks, loadBoards, showArchived]);

  /* ─── Scroll horizontal com shift+wheel ─── */
  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.shiftKey && e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [activeBoard?._id]);

  /* ─── CRUD boards ─── */
  const createBoard = () => setTplModal("create");
  const applyTemplate = async (payload) => {
    if (tplModal === "create") {
      const b = await api.post("/api/admin/boards", payload);
      await loadBoards();
      setActiveBoard(b);
    } else {
      const id = activeBoard._id;
      await api.post(`/api/admin/boards/${id}/template`, payload);
      await loadBoards();
      // O _id não muda na troca, então o effect de tasks não refaz sozinho —
      // recarrega explícito pra ver as tasks já remapeadas nas colunas novas.
      await loadTasks(id, showArchived);
    }
    setTplModal(null);
  };
  const deleteBoard = (id) => setDialog({ type: "confirm", title: t("kb.board.delete_title"), message: t("kb.board.delete_msg"), confirmLabel: t("kb.common.delete"), danger: true, onConfirm: async () => { await api.del(`/api/admin/boards/${id}`); setActiveBoard(null); await loadBoards(); } });
  const renameBoard = () => setDialog({ type: "prompt", title: t("kb.board.rename"), placeholder: t("kb.board.new_name"), defaultValue: activeBoard.name, confirmLabel: t("kb.common.save"), onConfirm: async (n) => { if (n !== activeBoard.name) { await api.patch(`/api/admin/boards/${activeBoard._id}`, { name: n }); loadBoards(); } } });

  /* ─── CRUD columns ─── */
  const addColumn = () => setDialog({ type: "prompt", title: t("kb.col.new"), placeholder: t("kb.col.name_ph"), confirmLabel: t("kb.common.create"), onConfirm: async (n) => { const cols = [...(activeBoard.columns||[]), { id: uid(), name: n, color: "#6b7280", position: (activeBoard.columns||[]).length }]; await api.patch(`/api/admin/boards/${activeBoard._id}`, { columns: cols }); loadBoards(); } });
  const updateColumn = async (colId, u) => { const cols = (activeBoard.columns||[]).map(c => c.id === colId ? { ...c, ...u } : c); await api.patch(`/api/admin/boards/${activeBoard._id}`, { columns: cols }); loadBoards(); setEditingCol(null); };
  const deleteColumn = (colId) => setDialog({ type: "confirm", title: t("kb.col.delete"), message: t("kb.col.delete_msg"), confirmLabel: t("kb.common.delete"), danger: true, onConfirm: async () => { const cols = (activeBoard.columns||[]).filter(c => c.id !== colId); await api.patch(`/api/admin/boards/${activeBoard._id}`, { columns: cols }); const fb = cols[0]?.id||"backlog"; const af = tasks.filter(t => t.status === colId); if (af.length > 0) await api.post("/api/admin/tasks/reorder", { updates: af.map((t,i) => ({ id: t._id, status: fb, position: 9000+i })) }); loadBoards(); loadTasks(activeBoard._id, showArchived); } });

  /* ─── CRUD tasks ─── */
  const createTask = async (title, columnId, assignee) => {
    if (!title.trim()) return;
    await api.post("/api/admin/tasks", { boardId: activeBoard._id, title: title.trim(), status: columnId, assignee: assignee || "", createdBy: me?.id || "", createdByName: me?.name || "" });
    setCreating(null);
    // socket vai broadcastar — não precisa loadTasks
  };
  const updateTask = async (id, patch) => {
    await api.patch(`/api/admin/tasks/${id}`, patch);
    // socket vai broadcastar
  };
  const deleteTask = (id) => setDialog({ type: "confirm", title: t("kb.card.delete"), message: t("kb.task.delete_msg"), confirmLabel: t("kb.common.delete"), danger: true, onConfirm: async () => { await api.del(`/api/admin/tasks/${id}`); if (detail?._id === id) setDetail(null); } });
  const archiveTask = async (id) => {
    await api.post(`/api/admin/tasks/${id}/archive`, {});
    // Se tiver aberta e não estivermos vendo arquivadas, fecha o detail
    if (!showArchived && detail?._id === id) setDetail(null);
    loadTasks(activeBoard._id, showArchived);
  };
  const unarchiveTask = async (id) => {
    await api.post(`/api/admin/tasks/${id}/unarchive`, {});
    loadTasks(activeBoard._id, showArchived);
  };
  const addComment = async (taskId, text, parentId = null) => { await api.post(`/api/admin/tasks/${taskId}/comments`, { text, author: me?.id || "", authorName: me?.name || "", parentId }); };
  const deleteComment = async (taskId, cId) => { await api.del(`/api/admin/tasks/${taskId}/comments/${cId}`); };
  const addAttachment = async (taskId, file) => {
    try { await api.post(`/api/admin/tasks/${taskId}/attachments`, file); }
    catch (e) { console.error("Erro ao anexar:", e); }
  };
  const removeAttachment = async (taskId, attachmentId) => {
    try { await api.del(`/api/admin/tasks/${taskId}/attachments/${attachmentId}`); }
    catch (e) { console.error("Erro ao remover anexo:", e); }
  };

  /* ─── Drag & drop ─── */
  const handleDragStart = (e, t) => { setDragState({ taskId: t._id }); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t._id); e.currentTarget.style.opacity = "0.35"; };
  const handleDragEnd = (e) => { e.currentTarget.style.opacity = "1"; setDragState(null); };
  const handleDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; };
  const handleDrop = async (e, targetCol, targetIndex) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain"); if (!taskId) return;
    const colTasks = tasks.filter(t => t.status === targetCol).sort((a,b) => (a.position||0) - (b.position||0));
    const filtered = colTasks.filter(t => t._id !== taskId);
    const idx = targetIndex !== undefined ? Math.min(targetIndex, filtered.length) : filtered.length;
    const reordered = [...filtered.slice(0, idx), { _id: taskId }, ...filtered.slice(idx)];
    const updates = reordered.map((t, i) => ({ id: t._id, status: targetCol, position: i }));
    if (!updates.find(u => u.id === taskId)) updates.push({ id: taskId, status: targetCol, position: idx });
    setTasks(prev => prev.map(t => { const u = updates.find(x => x.id === t._id); return u ? { ...t, status: u.status, position: u.position } : t; }));
    await api.post("/api/admin/tasks/reorder", { updates });
  };

  /* ─── Drag & drop de COLUNAS ─── */
  const handleColDragStart = (e, col) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-kb-col", col.id);
    e.dataTransfer.setData("text/plain", `col:${col.id}`); // fallback
    setColDragging(col.id);
  };
  const handleColDragEnd = () => {
    setColDragging(null);
    setColDropTarget(null);
  };
  const handleColDragOver = (e, targetColId) => {
    if (!colDragging || colDragging === targetColId) return;
    if (e.dataTransfer.types.includes("application/x-kb-col")) {
      e.preventDefault();
      setColDropTarget(targetColId);
    }
  };
  const handleColDrop = async (e, targetColId) => {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData("application/x-kb-col");
    setColDragging(null);
    setColDropTarget(null);
    if (!draggedId || draggedId === targetColId || !activeBoard) return;

    const cols = [...(activeBoard.columns || [])].sort((a, b) => (a.position || 0) - (b.position || 0));
    const fromIdx = cols.findIndex(c => c.id === draggedId);
    const toIdx = cols.findIndex(c => c.id === targetColId);
    if (fromIdx < 0 || toIdx < 0) return;

    const [moved] = cols.splice(fromIdx, 1);
    cols.splice(toIdx, 0, moved);
    const reordered = cols.map((c, i) => ({ ...c, position: i }));

    // optimistic
    setBoards(prev => prev.map(b => b._id === activeBoard._id ? { ...b, columns: reordered } : b));
    setActiveBoard(prev => prev ? { ...prev, columns: reordered } : prev);

    await api.patch(`/api/admin/boards/${activeBoard._id}`, { columns: reordered });
  };

  /* ─── Detail viewing tracking ─── */
  const openDetail = (task) => {
    setDetail(task);
    const sock = getSocket();
    if (sock) sock.emit("task:viewing", task._id);
  };
  const closeDetail = () => {
    setDetail(null);
    const sock = getSocket();
    if (sock) sock.emit("task:viewing", null);
  };

  /* ─── Filtros ─── */
  // Board de cliente: renomear/excluir ficam fora (o board pertence ao cliente)
  const isFixedBoard = !!clientId || !!activeBoard?.clientId;
  const activeClient = activeBoard?.clientId
    ? clients.find(c => String(c._id) === String(activeBoard.clientId))
    : null;
  const clientsFiltered = clientSearch.trim()
    ? clients.filter(c => `${c.name} ${c.segment || ""} ${c.email || ""}`.toLowerCase().includes(clientSearch.trim().toLowerCase()))
    : clients;
  const columns = activeBoard?.columns || defaultColumnsT(t);
  const filteredTasks = tasks.filter(t => {
    if (filters.assignee && t.assignee !== filters.assignee) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.label && !(t.labels||[]).includes(filters.label)) return false;
    if (filters.search && !t.title.toLowerCase().includes(filters.search.toLowerCase())) return false;
    return true;
  });
  const activeFiltersCount = [filters.assignee, filters.priority, filters.label, filters.search].filter(Boolean).length;

  const viewersByTask = {}; // presença no board foi removida: ninguém vigia ninguém

  // Escopo "Clientes" sem board de cliente ativo: NÃO mostrar o board interno
  // (mostrava com "Excluir board" habilitado, como se fosse do cliente).
  const clientScopeEmpty = !clientId && scope === "clientes" && !activeBoard?.clientId;

  // Só tranca a tela quando realmente não há nada — antes, zero board interno
  // deixava o escopo "Clientes" inalcançável.
  if (boards.length === 0 && !activeBoard && scope === "interno" && !clientId) return (
    <div className="kb-root">
      <div className="kb-empty-state">
        <div style={{ marginBottom: 16, color: "var(--ink-faint)" }}><Icon name="board" size={32} /></div>
        <div style={{ fontFamily: "var(--heading)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>{t("kb.empty.title")}</div>
        <div style={{ fontSize: 13, color: "var(--ink-mute)", marginBottom: 24 }}>{t("kb.empty.sub")}</div>
        <button className="btn-primary" onClick={createBoard}><Icon name="plus" size={14} /> {t("kb.tpl.create_board")}</button>
      </div>
      {dialog && <KBDialog config={dialog} onClose={() => setDialog(null)} />}
    </div>
  );

  return (
    <div className="kb-root">
      {showArchived && (
        <div className="kb-archived-banner">
          <Icon name="eye" size={12} />
          <span>{t("kb.archived.banner")}</span>
          <button onClick={() => setShowArchived(false)}>{t("kb.archived.back")}</button>
        </div>
      )}
      <div className="kb-topbar">
        <div className="kb-topbar-left">
          {clientId ? (
            <div className="kb-board-tabs">
              <span className="kb-board-tab kb-board-tab--active" style={{ cursor: "default" }}>
                <Icon name="board" size={14} /><span>Kanban · {activeBoard?.name || t("kb.client_fallback")}</span>
              </span>
            </div>
          ) : (
            <>
              {/* Escopo bem visível: boards internos ou o Kanban de um cliente */}
              <div className="kb-scope">
                <button
                  className={`kb-scope-btn ${scope === "interno" ? "kb-scope-btn--active" : ""}`}
                  onClick={() => switchScope("interno")}
                >
                  <Icon name="board" size={13} /> {t("kb.scope.internal")}
                </button>
                <button
                  className={`kb-scope-btn ${scope === "clientes" ? "kb-scope-btn--active" : ""}`}
                  onClick={() => switchScope("clientes")}
                >
                  <Icon name="clients" size={13} /> {t("kb.scope.clients")}
                  {clients.length > 0 && <span className="kb-scope-count">{clients.length}</span>}
                </button>
              </div>

              <div className="kb-scope-sep" />

              {scope === "interno" ? (
                <div className="kb-board-tabs">
                  {boards.map(b => (
                    <button key={b._id} className={`kb-board-tab ${activeBoard?._id === b._id ? "kb-board-tab--active" : ""}`} onClick={() => setActiveBoard(b)}>
                      <Icon name="board" size={14} /><span>{b.name}</span>
                    </button>
                  ))}
                  <button className="kb-board-tab kb-board-tab--add" onClick={createBoard} title={t("kb.tpl.new_board")}><Icon name="plus" size={13} /></button>
                </div>
              ) : clients.length === 0 ? (
                <span className="kb-board-tab" style={{ color: "var(--ink-faint)", cursor: "default" }}>
                  {t("kb.scope.no_clients")}
                </span>
              ) : (
                /* Seletor de cliente: dropdown com busca — aguenta muitos
                   clientes sem estourar a topbar (tabs colidiam com a direita). */
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <button ref={clientPickerFloat.anchorRef} className="kb-client-picker" onClick={clientPickerFloat.toggle}>
                    <Icon name="clients" size={14} />
                    <span>{activeClient?.name || activeBoard?.name || t("kb.client.pick")}</span>
                    <Icon name="chevDown" size={12} />
                  </button>
                  {clientPickerFloat.isOpen && createPortal(
                    <div ref={clientPickerFloat.floatingRef} className="kb-dropdown kb-dropdown--portal kb-client-menu" style={{ top: clientPickerFloat.pos.top, left: clientPickerFloat.pos.left }}>
                      <div className="kb-client-menu-search">
                        <Icon name="search" size={13} />
                        <input
                          autoFocus
                          placeholder={t("kb.client.search")}
                          value={clientSearch}
                          onChange={e => setClientSearch(e.target.value)}
                        />
                      </div>
                      <div className="kb-client-menu-list">
                        {clientsFiltered.length === 0 ? (
                          <div className="kb-client-menu-empty">{t("kb.client.no_match")}</div>
                        ) : clientsFiltered.map(c => {
                          const on = activeBoard?.clientId && String(activeBoard.clientId) === String(c._id);
                          return (
                            <button
                              key={c._id}
                              className={on ? "kb-client-menu-item kb-client-menu-item--on" : "kb-client-menu-item"}
                              onClick={() => { selectClientBoard(c._id); setClientSearch(""); clientPickerFloat.close(); }}
                            >
                              <span className="kb-client-menu-name">{c.name}</span>
                              {c.segment && <span className="kb-client-menu-seg">{c.segment}</span>}
                              {on && <Icon name="check" size={12} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>,
                    document.body
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <div className="kb-topbar-right">
          {/* Pasta no runner: só aparece quando o board TEM task de agent, que é
              quando ela passa a importar. Sem ela o play é um botão que não faz
              nada — e o motivo só aparecia no terminal de quem roda o runner. */}
          {activeBoard && temTaskDeAgent && (
            <button
              className={`kb-runall${semPastaRunner ? "" : " on"}`}
              title={semPastaRunner
                ? t("kb.runner.no_folder_title")
                : t("kb.runner.folder_title", { path: pastaDoBoard })}
              onClick={editarPastaRunner}
            >
              <Icon name="board" size={11} />
              {semPastaRunner ? t("kb.runner.no_folder") : t("kb.runner.folder")}
            </button>
          )}
          {/* EM QUAL MÁQUINA. O caminho acima existe num sistema de arquivos só,
              então na prática o board já é de uma máquina — aqui isso vira
              explícito e o claim para de oferecer a task pro runner errado. */}
          {activeBoard && temTaskDeAgent && (
            <select
              /* estilo inline: `rn-modo` mora no runner.css, que o kanban não carrega */
              style={{
                background: "var(--bg, var(--canvas))", border: "1px solid var(--line)",
                borderRadius: "var(--r-sm)", color: "var(--ink-faint)",
                padding: "3px 6px", fontSize: "var(--t-xs)", cursor: "pointer", flex: "0 0 auto",
              }}
              value={maquinaDoBoard || ""}
              onChange={e => salvarMaquinaBoard(e.target.value)}
              title={(() => {
                if (!maquinaDoBoard) return t("kb.machine.any_title");
                const m = maquinas.find(x => x.machineId === maquinaDoBoard);
                if (!m) return t("kb.machine.gone_title");
                return m.online ? t("kb.machine.online_title", { name: m.nome }) : t("kb.machine.offline_title", { name: m.nome });
              })()}
            >
              <option value="">{t("kb.machine.any")}</option>
              {maquinas.map(m => (
                <option key={m.machineId} value={m.machineId}>{m.online ? "● " : "○ "}{m.nome}</option>
              ))}
              {maquinaDoBoard && !maquinas.some(m => m.machineId === maquinaDoBoard) && (
                <option value={maquinaDoBoard}>{t("kb.machine.gone", { id: String(maquinaDoBoard).slice(0, 8) })}</option>
              )}
            </select>
          )}
          {/* board inteiro: pede execução de tudo que tem agent responsável,
              na ordem das colunas. Concluídas e travadas ficam de fora. */}
          {(() => {
            const deAgent = tasks.filter(t => String(t.assignee || "").startsWith("agent:"));
            const pedidas = deAgent.filter(t => t.pedidoEm).length;
            if (!deAgent.length) return null;
            return pedidas === deAgent.length ? (
              <button
                className="kb-runall on"
                title={t("kb.runall.cancel_title")}
                onClick={() => cancelarLote({ boardId: activeBoard._id })}
              >
                <Icon name="play" size={11} /> {t("kb.runall.queued", { n: pedidas })}
              </button>
            ) : (
              <button
                className="kb-runall"
                title={semPastaRunner
                  ? t("kb.runall.no_folder_title")
                  : t("kb.runall.title", { n: deAgent.length })}
                onClick={() => {
                  /* Deixa pedir mesmo sem pasta (pode haver runner com a pasta
                     configurada de outro jeito), mas não deixa fazer isso sem
                     saber: o silêncio é que era o problema. */
                  if (semPastaRunner && !window.confirm(t("kb.runall.confirm"))) return;
                  pedirLote({ boardId: activeBoard._id });
                }}
              >
                <Icon name="play" size={11} /> {t("kb.runall.btn", { n: deAgent.length })}
              </button>
            );
          })()}
          {!clientId && <NotifBell me={me} onOpenTask={onOpenTask} />}
          <div className="kb-search"><Icon name="search" size={14} /><input placeholder={t("kb.search")} value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} /></div>
          <button className={`kb-filter-btn ${activeFiltersCount > 0 ? "kb-filter-btn--active" : ""}`} onClick={() => setShowFilters(!showFilters)}><Icon name="filter" size={14} /> {t("kb.filters")} {activeFiltersCount > 0 && <span className="kb-filter-count">{activeFiltersCount}</span>}</button>
          <div className="kb-view-toggle"><button className={viewMode === "board" ? "active" : ""} onClick={() => setViewMode("board")}><Icon name="columns" size={14} /></button><button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")}><Icon name="list" size={14} /></button></div>
          <div style={{ position: "relative" }}>
            <button ref={boardMenuFloat.anchorRef} className="icon-btn" onClick={boardMenuFloat.toggle}><Icon name="more" size={16} /></button>
            {boardMenuFloat.isOpen && createPortal(
              <div ref={boardMenuFloat.floatingRef} className="kb-dropdown kb-dropdown--portal" style={{ top: boardMenuFloat.pos.top, right: boardMenuFloat.pos.right }}>
                {!isFixedBoard && <button onClick={() => { renameBoard(); boardMenuFloat.close(); }}>{t("kb.board.rename")}</button>}
                <button onClick={() => { setTplModal("switch"); boardMenuFloat.close(); }}>{t("kb.tpl.switch")}</button>
                <button onClick={() => { addColumn(); boardMenuFloat.close(); }}>{t("kb.menu.add_col")}</button>
                <button onClick={() => { setShowArchived(v => !v); boardMenuFloat.close(); }}>{showArchived ? t("kb.menu.hide_archived") : t("kb.menu.show_archived")}</button>
                {!isFixedBoard && <>
                  <hr />
                  {ehSocio() && <button className="danger" onClick={() => { deleteBoard(activeBoard._id); boardMenuFloat.close(); }}>{t("kb.board.delete_title")}</button>}
                </>}
              </div>,
              document.body
            )}
          </div>
        </div>
      </div>

      {showFilters && (
        <div className="kb-filters-bar">
          <div className="kb-filter-group"><label>{t("kb.list.assignee")}</label><MemberPicker value={filters.assignee} onChange={v => setFilters(f => ({ ...f, assignee: v }))} /></div>
          <div className="kb-filter-group"><label>{t("kb.list.priority")}</label><KBSelect value={filters.priority} options={prioritiesT(t)} onChange={v => setFilters(f => ({ ...f, priority: v }))} placeholder={t("kb.filter.all")} renderOption={o => <span style={{ color: o.color, fontWeight: 600 }}>{o.icon} {o.label}</span>} /></div>
          <div className="kb-filter-group"><label>{t("kb.filter.label")}</label><KBSelect value={filters.label} options={LABEL_COLORS.map(l => ({ id: l.id, label: l.id, bg: l.bg, fg: l.fg }))} onChange={v => setFilters(f => ({ ...f, label: v }))} placeholder={t("kb.filter.all")} renderOption={o => <span className="kb-label" style={{ background: o.bg, color: o.fg }}>{o.label}</span>} /></div>
          {activeFiltersCount > 0 && <button className="kb-clear-filters" onClick={() => setFilters({ assignee: "", priority: "", label: "", search: "" })}>{t("kb.common.clear")}</button>}
        </div>
      )}

      {clientScopeEmpty ? (
        <div className="kb-empty-state">
          <div style={{ marginBottom: 16, color: "var(--ink-faint)" }}><Icon name="clients" size={32} /></div>
          <div style={{ fontFamily: "var(--heading)", fontWeight: 700, fontSize: 18, marginBottom: 6 }}>
            {clients.length === 0 ? t("kb.clients_empty.none") : t("kb.clients_empty.pick")}
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-mute)" }}>
            {clients.length === 0
              ? t("kb.clients_empty.none_sub")
              : t("kb.clients_empty.pick_sub")}
          </div>
        </div>
      ) : viewMode === "board" ? (
        <div className="kb-board-wrap" ref={boardScrollRef}>
          <div className="kb-board">
            {columns.sort((a,b) => (a.position||0) - (b.position||0)).map(col => {
              const ct = filteredTasks.filter(t => t.status === col.id).sort((a,b) => (a.position||0) - (b.position||0));
              return <KanbanColumn
                key={col.id}
                col={col}
                tasks={ct}
                semPastaRunner={semPastaRunner}
                viewersByTask={viewersByTask}
                creating={creating === col.id}
                onStartCreate={() => setCreating(col.id)}
                onCancelCreate={() => setCreating(null)}
                onCreateTask={(t,a) => createTask(t, col.id, a)}
                onOpenTask={openDetail}
                onDeleteTask={deleteTask}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={(e,i) => handleDrop(e, col.id, i)}
                dragState={dragState}
                onEditCol={() => setEditingCol(col)}
                onDeleteCol={() => deleteColumn(col.id)}
                onMoveRequest={setMoveTask}
                onChanged={() => activeBoard && loadTasks(activeBoard._id, showArchived)}
                sel={sel}
                onToggleSel={toggleSel}
                modoSel={sel.size > 0}
                onColDragStart={handleColDragStart}
                onColDragEnd={handleColDragEnd}
                onColDragOver={handleColDragOver}
                onColDrop={handleColDrop}
                colDragging={colDragging}
                colDropTarget={colDropTarget}
              />;
            })}
            <div className="kb-col kb-col--add" onClick={addColumn}><Icon name="plus" size={16} /><span>{t("kb.col.add_col")}</span></div>
          </div>
        </div>
      ) : <ListView tasks={filteredTasks} columns={columns} onOpenTask={openDetail} onDeleteTask={deleteTask} />}

      {sel.size > 0 && (
        <div className="kb-selbar" role="region" aria-label={t("kb.sel.aria")}>
          <b>{sel.size}</b> {t(sel.size > 1 ? "kb.sel.countN" : "kb.sel.count1")}
          <button className="kb-selbar-btn" onClick={() => setSel(new Set())}>{t("kb.sel.clear")}</button>
          {/* só faz sentido pra task de agent — humano não tem runner */}
          {[...sel].some(id => String(tasks.find(t => t._id === id)?.assignee || "").startsWith("agent:")) && (
            <button className="kb-selbar-btn" onClick={() => pedirLote({ ids: [...sel] })}>
              {t("kb.sel.request")}
            </button>
          )}
          <button
            className="kb-selbar-btn danger"
            onClick={() => setDialog({
              type: "confirm",
              title: sel.size > 1 ? t("kb.sel.delete_titleN", { n: sel.size }) : t("kb.sel.delete_title1"),
              message: t("kb.task.delete_msg"),
              confirmLabel: t("kb.common.delete"),
              danger: true,
              onConfirm: async () => {
                const ids = [...sel];
                setSel(new Set());
                for (const id of ids) await api.del(`/api/admin/tasks/${id}`).catch(() => {});
                if (detail && ids.includes(detail._id)) setDetail(null);
              },
            })}
          >{t("kb.sel.delete_btn")}</button>
        </div>
      )}

      {loteMsg && (
        <div className="kb-lotebar" role="status" onClick={() => setLoteMsg("")}>
          {loteMsg}
        </div>
      )}

      {editingCol && <ColumnEditModal col={editingCol} onClose={() => setEditingCol(null)} onSave={u => updateColumn(editingCol.id, u)} onDelete={() => { deleteColumn(editingCol.id); setEditingCol(null); }} />}
      {tplModal && <TemplateModal mode={tplModal === "create" ? "create" : "switch"} board={activeBoard} onClose={() => setTplModal(null)} onConfirm={applyTemplate} />}
      {moveTask && <MoveTaskSheet task={moveTask} columns={columns} onClose={() => setMoveTask(null)} onMove={(toCol) => updateTask(moveTask._id, { status: toCol })} />}
      {detail && <TaskDetail task={tasks.find(t => t._id === detail._id) || detail} columns={columns} me={me} viewers={viewersByTask[detail._id] || []} onClose={closeDetail} onUpdate={p => updateTask(detail._id, p)} onDelete={() => deleteTask(detail._id)} onArchive={() => archiveTask(detail._id)} onUnarchive={() => unarchiveTask(detail._id)} onAddComment={(t, parentId) => addComment(detail._id, t, parentId)} onDeleteComment={cId => deleteComment(detail._id, cId)} onAddAttachment={file => addAttachment(detail._id, file)} onRemoveAttachment={aId => removeAttachment(detail._id, aId)} />}
      {dialog && <KBDialog config={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}