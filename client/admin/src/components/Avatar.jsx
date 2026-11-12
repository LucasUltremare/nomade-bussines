export function Avatar({ member, size = 22, showName = false, muted = false }) {
  if (!member) return null;
  return (
    <div className="kb-av" style={muted ? { opacity: 0.5 } : {}}>
      <div className="kb-av-circle" style={{ background: member.color, width: size, height: size, fontSize: size < 20 ? 7 : 8 }} title={member.name}>{member.initials}</div>
      {showName && <span className="kb-av-name">{member.name}</span>}
    </div>
  );
}
