import { useState, useEffect } from "react";
import { Icon } from "../../../components/Icon.jsx";
import { Avatar } from "../../../components/Avatar.jsx";
import { TEAM } from "../../../lib/team.js";
import { renderWithMentions } from "../../../lib/mentions.jsx";
import { useGoogleDrivePicker } from "../../../hooks/useGoogleDrivePicker.js";
import { prioritiesT, LABEL_COLORS, uid } from "../constants.js";
import { KBSelect } from "./KBSelect.jsx";
import { KBDatePicker } from "./KBDatePicker.jsx";
import { MemberPicker } from "./MemberPicker.jsx";
import { KBDialog } from "./KBDialog.jsx";
import { MentionComposer } from "./MentionComposer.jsx";
import { AttachmentsList } from "./AttachmentsList.jsx";
import { api } from "../../../api/client.js";
import { useT, localeOf } from "../../../i18n/index.jsx";

/* ──────────────────────────────────────────
   TASK DETAIL PANEL
   ────────────────────────────────────────── */

export function TaskDetail({ task, columns, me, viewers, onClose, onUpdate, onDelete, onArchive, onUnarchive, onAddComment, onDeleteComment, onAddAttachment, onRemoveAttachment }) {
  const { t, lang } = useT();
  const [editTitle, setEditTitle] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description || "");
  const [commentText, setCommentText] = useState("");
  const [tab, setTab] = useState("detail");
  const [dlg, setDlg] = useState(null);
  const [clients, setClients] = useState([]);

  useEffect(() => {
    let cancel = false;
    api.get("/api/admin/clients").then((list) => {
      if (!cancel) setClients(list || []);
    }).catch(() => {});
    return () => { cancel = true; };
  }, []);
  const [replyingTo, setReplyingTo] = useState(null); // comment object que estamos respondendo

  const picker = useGoogleDrivePicker({
    onPick: (file) => {
      if (onAddAttachment) onAddAttachment(file);
    },
  });

  useEffect(() => { setTitle(task.title); setDesc(task.description || ""); }, [task._id, task.title, task.description]);

  const saveTitle = () => { if (title.trim() && title !== task.title) onUpdate({ title: title.trim() }); setEditTitle(false); };
  const saveDesc = () => { if (desc !== (task.description || "")) onUpdate({ description: desc }); };
  const addSub = () => setDlg({ type: "prompt", title: t("kb.detail.new_sub"), placeholder: t("kb.detail.sub_placeholder"), confirmLabel: t("kb.common.add"), onConfirm: (title) => onUpdate({ subtasks: [...(task.subtasks||[]), { id: uid(), title, done: false }] }) });
  const toggleSub = id => onUpdate({ subtasks: (task.subtasks||[]).map(s => s.id === id ? { ...s, done: !s.done } : s) });
  const delSub = id => onUpdate({ subtasks: (task.subtasks||[]).filter(s => s.id !== id) });
  const toggleLabel = lid => { const l = task.labels||[]; onUpdate({ labels: l.includes(lid) ? l.filter(x => x !== lid) : [...l, lid] }); };
  const sendComment = () => {
    if (!commentText.trim()) return;
    onAddComment(commentText.trim(), replyingTo?.id || null);
    setCommentText("");
    setReplyingTo(null);
  };

  // Agrupa comments: top-level + replies por parentId
  const allComments = task.comments || [];
  const topComments = allComments.filter(c => !c.parentId);
  const repliesByParent = allComments.reduce((acc, c) => {
    if (c.parentId) {
      if (!acc[c.parentId]) acc[c.parentId] = [];
      acc[c.parentId].push(c);
    }
    return acc;
  }, {});

  const creator = TEAM.find(m => m.name === task.createdByName || m.id === task.createdBy);

  return (
    <><div className="kb-detail-backdrop" onClick={onClose} />
    <div className="kb-detail">
      <div className="kb-detail-header">
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button className={`kb-detail-tab ${tab === "detail" ? "active" : ""}`} onClick={() => setTab("detail")}>{t("kb.detail.tab_details")}</button>
          <button className={`kb-detail-tab ${tab === "activity" ? "active" : ""}`} onClick={() => setTab("activity")}>{t("kb.detail.tab_activity")} {(task.comments||[]).length > 0 && <span className="kb-tab-badge">{(task.comments||[]).length}</span>}</button>
          {viewers.length > 0 && (
            <div className="kb-detail-viewers" title={t("kb.detail.also_viewing", { names: viewers.map(v => v.name).join(", ") })}>
              <Icon name="eye" size={11} />
              {viewers.slice(0,3).map(v => <Avatar key={v.id} member={v} size={16} />)}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="icon-btn" onClick={task.archived ? onUnarchive : onArchive} title={task.archived ? t("kb.detail.unarchive") : t("kb.detail.archive")}>
            <Icon name={task.archived ? "eye" : "check"} size={15} />
          </button>
          <button className="icon-btn" onClick={onDelete} title={t("kb.common.delete")}><Icon name="trash" size={15} /></button>
          <button className="icon-btn" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
      </div>

      <div className="kb-detail-body">
        {tab === "detail" ? (<>
          {editTitle
            ? <input className="kb-detail-title-input" value={title} onChange={e => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={e => e.key === "Enter" && saveTitle()} autoFocus />
            : <h2 className="kb-detail-title" onClick={() => setEditTitle(true)}>{task.title}</h2>}
          {creator && <div className="kb-created-by"><Avatar member={creator} size={16} /><span>{t("kb.detail.created_this")}</span></div>}

          <div className="kb-props">
            <div className="kb-prop"><label>{t("kb.list.status")}</label><KBSelect value={task.status} options={columns.map(c => ({ id: c.id, label: c.name, color: c.color }))} onChange={v => onUpdate({ status: v })} renderOption={o => <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: o.color }} />{o.label}</span>} /></div>
            <div className="kb-prop"><label>{t("kb.list.assignee")}</label><MemberPicker value={task.assignee||""} onChange={v => onUpdate({ assignee: v })} /></div>
            <div className="kb-prop"><label>{t("kb.list.priority")}</label><KBSelect value={task.priority||"medium"} options={prioritiesT(t)} onChange={v => onUpdate({ priority: v })} renderOption={o => <span style={{ color: o.color, fontWeight: 600 }}>{o.icon} {o.label}</span>} /></div>
            <div className="kb-prop"><label>{t("kb.list.due")}</label><KBDatePicker value={task.dueDate ? new Date(task.dueDate).toISOString().slice(0,10) : ""} onChange={v => onUpdate({ dueDate: v || null })} /></div>
          </div>

          <div className="kb-section"><div className="kb-section-title">{t("kb.detail.labels")}</div><div className="kb-labels-grid">{LABEL_COLORS.map(l => <button key={l.id} className={`kb-label-toggle ${(task.labels||[]).includes(l.id) ? "kb-label-toggle--active" : ""}`} style={{ background: l.bg, color: l.fg, borderColor: (task.labels||[]).includes(l.id) ? l.fg : "transparent" }} onClick={() => toggleLabel(l.id)}>{l.id}</button>)}</div></div>

          <div className="kb-section">
            <div className="kb-section-title">{t("kb.detail.client")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <select
                value={task.clientEmail || ""}
                onChange={(e) => onUpdate({ clientEmail: e.target.value || null })}
                style={{
                  width: "100%", padding: "8px 10px",
                  borderRadius: 6, border: "1px solid var(--border, rgba(0,0,0,.1))",
                  background: "var(--bg, #fff)", color: "var(--ink, #051017)",
                  fontSize: 13, outline: "none",
                }}
              >
                <option value="">{t("kb.detail.no_client")}</option>
                {clients.map((c) => (
                  <option key={c._id} value={c.email}>
                    {c.name || c.email} ({c.email})
                  </option>
                ))}
              </select>

              {task.clientEmail && (
                <>
                  <label
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 10px", borderRadius: 6,
                      background: task.visibleToClient ? "rgba(0,168,150,.08)" : "rgba(0,0,0,.02)",
                      border: `1px solid ${task.visibleToClient ? "rgba(0,168,150,.3)" : "rgba(0,0,0,.06)"}`,
                      cursor: "pointer", fontSize: 12.5,
                      color: task.visibleToClient ? "#006559" : "var(--ink-faint, rgba(0,0,0,.6))",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={!!task.visibleToClient}
                      onChange={(e) => onUpdate({ visibleToClient: e.target.checked })}
                      style={{ accentColor: "#00A896" }}
                    />
                    <span>
                      <strong>{t("kb.detail.visible")}</strong>
                      {task.visibleToClient && t("kb.detail.visible_sub")}
                    </span>
                  </label>

                  <input
                    type="text"
                    value={task.clientStatusLabel || ""}
                    onChange={(e) => onUpdate({ clientStatusLabel: e.target.value || null })}
                    placeholder={t("kb.detail.client_label_ph")}
                    style={{
                      width: "100%", padding: "7px 10px",
                      borderRadius: 6, border: "1px solid var(--border, rgba(0,0,0,.1))",
                      background: "var(--bg, #fff)", color: "var(--ink, #051017)",
                      fontSize: 12.5, outline: "none",
                    }}
                  />
                </>
              )}
            </div>
          </div>
          <div className="kb-section">
            <div className="kb-section-header">
              <div className="kb-section-title">{t("kb.detail.description")}</div>
              <button
                className="kb-add-btn"
                onClick={() => picker.open()}
                disabled={picker.loading}
                title={picker.configured ? t("kb.detail.attach_title") : t("kb.detail.picker_off")}
              >
                <Icon name="plus" size={12} /> {picker.loading ? t("kb.detail.opening") : t("kb.detail.attach_drive")}
              </button>
            </div>
            <textarea className="kb-desc-input" placeholder={t("kb.detail.desc_ph")} value={desc} onChange={e => setDesc(e.target.value)} onBlur={saveDesc} rows={3} />
            {picker.error && <div className="kb-attach-error">{picker.error}</div>}
            <AttachmentsList
              attachments={task.attachments || []}
              onRemove={onRemoveAttachment}
            />
          </div>

          <div className="kb-section">
            <div className="kb-section-header">
              <div className="kb-section-title">{t("kb.detail.subtasks")} {(task.subtasks||[]).length > 0 && <span className="kb-section-count">{(task.subtasks||[]).filter(s => s.done).length}/{(task.subtasks||[]).length}</span>}</div>
              <button className="kb-add-btn" onClick={addSub}><Icon name="plus" size={12} /> {t("kb.detail.add_sub")}</button>
            </div>
            <div className="kb-checklist">{(task.subtasks||[]).map(s => <div key={s.id} className="kb-check-item"><button className={`kb-checkbox ${s.done ? "kb-checkbox--checked" : ""}`} onClick={() => toggleSub(s.id)}>{s.done && <Icon name="check" size={10} />}</button><span style={{ flex: 1, textDecoration: s.done ? "line-through" : "none", color: s.done ? "var(--ink-faint)" : "var(--ink)" }}>{s.title}</span><button className="kb-x-btn" onClick={() => delSub(s.id)}><Icon name="close" size={10} /></button></div>)}</div>
          </div>

        </>) : (
          <div className="kb-activity">
            <div className="kb-comments">
              {topComments.length === 0 ? <div className="kb-no-comments">{t("kb.comment.empty")}</div> :
                topComments.map(c => {
                  const m = TEAM.find(x => x.id === c.author || x.name === c.authorName);
                  const replies = repliesByParent[c.id] || [];
                  return (
                    <div key={c.id} className="kb-comment-thread">
                      <CommentItem
                        comment={c}
                        member={m}
                        me={me}
                        onReply={() => setReplyingTo(c)}
                        onDelete={() => onDeleteComment(c.id)}
                      />
                      {replies.length > 0 && (
                        <div className="kb-replies">
                          {replies.map(r => {
                            const rm = TEAM.find(x => x.id === r.author || x.name === r.authorName);
                            return (
                              <CommentItem
                                key={r.id}
                                comment={r}
                                member={rm}
                                me={me}
                                onDelete={() => onDeleteComment(r.id)}
                                isReply
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            {replyingTo && (
              <div className="kb-reply-banner">
                <Icon name="comment" size={11} />
                <span>{t("kb.comment.replying")} <strong>{replyingTo.authorName || replyingTo.author}</strong></span>
                <button className="kb-reply-cancel" onClick={() => setReplyingTo(null)} title={t("kb.comment.cancel_reply")}>
                  <Icon name="close" size={11} />
                </button>
              </div>
            )}

            <div className="kb-comment-input">
              <div className="kb-comment-input-row">
                {me && <Avatar member={me} size={24} />}
                <MentionComposer
                  value={commentText}
                  onChange={setCommentText}
                  onSubmit={sendComment}
                  placeholder={replyingTo ? t("kb.comment.reply_ph", { name: replyingTo.authorName }) : t("kb.comment.ph")}
                />
              </div>
              <div className="kb-comment-input-hint">
                <Icon name="at" size={11} /> {t("kb.comment.hint_use")} <strong>{t("kb.comment.hint_mention")}</strong> {t("kb.comment.hint_rest")}
              </div>
              <button className="kb-btn-send" onClick={sendComment} disabled={!commentText.trim()}>
                <Icon name="send" size={12} /> {replyingTo ? t("kb.comment.reply") : t("kb.comment.send")}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="kb-detail-footer">
        {creator && <span>{t("kb.list.created_by")} <strong>{creator.name}</strong> ·</span>}
        <span>{task.createdAt ? new Date(task.createdAt).toLocaleDateString(localeOf(lang)) : "—"}</span>
        {task.updatedAt && <span>{t("kb.detail.edited", { date: new Date(task.updatedAt).toLocaleDateString(localeOf(lang)) })}</span>}
      </div>
    </div>
    {dlg && <KBDialog config={dlg} onClose={() => setDlg(null)} />}
    </>
  );
}

/* ──────────────────────────────────────────
   COMMENT ITEM — 1 comment (top ou reply)
   ────────────────────────────────────────── */

function CommentItem({ comment, member, me, onReply, onDelete, isReply }) {
  const { t, lang } = useT();
  const c = comment;
  const avatarFallback = member || { initials: (c.authorName||"?")[0], color: "#6b7280", name: c.authorName };
  return (
    <div className={`kb-comment ${isReply ? "kb-comment--reply" : ""}`}>
      <Avatar member={avatarFallback} size={isReply ? 20 : 24} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="kb-comment-header">
          <span className="kb-comment-author">{c.authorName || c.author}</span>
          <span className="kb-comment-time">
            {c.createdAt ? new Date(c.createdAt).toLocaleDateString(localeOf(lang), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
            {onReply && (
              <button className="kb-comment-action" onClick={onReply} title={t("kb.comment.reply")}>
                <Icon name="comment" size={11} />
                <span>{t("kb.comment.reply")}</span>
              </button>
            )}
            <button className="kb-x-btn" style={{ opacity: .6 }} onClick={onDelete} title={t("kb.common.delete")}>
              <Icon name="close" size={10} />
            </button>
          </div>
        </div>
        <div className="kb-comment-body">{renderWithMentions(c.text, me)}</div>
      </div>
    </div>
  );
}