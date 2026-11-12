import { useState, useRef } from "react";
import { Avatar } from "../../../components/Avatar.jsx";
import { TEAM } from "../../../lib/team.js";

/* ──────────────────────────────────────────
   MENTION COMPOSER — textarea com autocomplete @nome
   ────────────────────────────────────────── */

export function MentionComposer({ value, onChange, onSubmit, placeholder }) {
  const taRef = useRef(null);
  const [showMenu, setShowMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const filtered = TEAM.filter(m =>
    !query || m.id.includes(query.toLowerCase()) || m.name.toLowerCase().includes(query.toLowerCase())
  );

  // Detecta @ que está sendo digitado (depois do último @)
  const detectMention = (text, caretPos) => {
    const before = text.slice(0, caretPos);
    const match = before.match(/@(\w*)$/);
    if (match) {
      setShowMenu(true);
      setQuery(match[1]);
      setHighlight(0);
    } else {
      setShowMenu(false);
    }
  };

  const handleChange = (e) => {
    onChange(e.target.value);
    detectMention(e.target.value, e.target.selectionStart);
  };

  const insertMention = (member) => {
    const ta = taRef.current;
    if (!ta) return;
    const caret = ta.selectionStart;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    // Substitui o "@xxx" sendo digitado por "@id "
    const newBefore = before.replace(/@\w*$/, `@${member.id} `);
    const newValue = newBefore + after;
    onChange(newValue);
    setShowMenu(false);
    // Restaura caret após a menção
    setTimeout(() => {
      ta.focus();
      const pos = newBefore.length;
      ta.setSelectionRange(pos, pos);
    }, 0);
  };

  const handleKeyDown = (e) => {
    if (showMenu && filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => (h + 1) % filtered.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => (h - 1 + filtered.length) % filtered.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertMention(filtered[highlight]); return; }
      if (e.key === "Escape") { e.preventDefault(); setShowMenu(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !showMenu) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="kb-mention-wrap">
      <textarea
        ref={taRef}
        className="kb-mention-input"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
      />
      {showMenu && filtered.length > 0 && (
        <div className="kb-mention-menu">
          {filtered.map((m, i) => (
            <button
              key={m.id}
              className={`kb-mention-opt ${i === highlight ? "kb-mention-opt--active" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => insertMention(m)}
              type="button"
            >
              <Avatar member={m} size={20} />
              <span className="kb-mention-name">{m.name}</span>
              <span className="kb-mention-id">@{m.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
