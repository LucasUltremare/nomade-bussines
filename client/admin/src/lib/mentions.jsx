import { TEAM } from "./team.js";

/* ══════════════════════════════════════════════════════════
   renderWithMentions — destaca @menções no texto do comentário
   ══════════════════════════════════════════════════════════ */

export function renderWithMentions(text, me) {
  if (!text) return null;
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) => {
    if (part.startsWith("@")) {
      const id = part.slice(1).toLowerCase();
      const member = TEAM.find(m => m.id === id);
      if (member) {
        const isMe = me && member.email === me.email;
        return (
          <span key={i} className={`kb-mention-tag ${isMe ? "kb-mention-tag--me" : ""}`} style={{ "--c": member.color }}>
            @{member.name}
          </span>
        );
      }
    }
    return <span key={i}>{part}</span>;
  });
}
