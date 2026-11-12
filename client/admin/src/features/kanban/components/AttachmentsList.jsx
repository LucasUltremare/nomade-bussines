import { Icon } from "../../../components/Icon.jsx";
import { useT } from "../../../i18n/index.jsx";

/* ──────────────────────────────────────────
   ATTACHMENTS — lista de anexos do Drive
   ────────────────────────────────────────── */

// ícone por mime-type
function fileIcon(mimeType = "") {
  if (mimeType.includes("folder")) return "folder";
  if (mimeType.includes("spreadsheet")) return "table";
  if (mimeType.includes("presentation")) return "columns";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "film";
  if (mimeType.startsWith("audio/")) return "music";
  return "file";
}

function fileTypeLabel(mimeType = "", t) {
  if (mimeType.includes("spreadsheet")) return t("kb.file.spreadsheet");
  if (mimeType.includes("document")) return t("kb.file.document");
  if (mimeType.includes("presentation")) return t("kb.file.presentation");
  if (mimeType.includes("pdf")) return t("kb.file.pdf");
  if (mimeType.includes("folder")) return t("kb.file.folder");
  if (mimeType.startsWith("image/")) return t("kb.file.image");
  if (mimeType.startsWith("video/")) return t("kb.file.video");
  return t("kb.file.file");
}

export function AttachmentsList({ attachments, onRemove }) {
  const { t } = useT();
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="kb-attachments">
      {attachments.map(a => (
        <a
          key={a.id}
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="kb-attachment"
          title={a.name}
        >
          <span className="kb-attachment-icon"><Icon name={fileIcon(a.mimeType)} size={15} /></span>
          <div className="kb-attachment-body">
            <div className="kb-attachment-name">{a.name}</div>
            <div className="kb-attachment-meta">
              {fileTypeLabel(a.mimeType, t)} · Google Drive
            </div>
          </div>
          {onRemove && (
            <button
              className="kb-attachment-remove"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(a.id); }}
              title={t("kb.attach.remove")}
            >
              <Icon name="close" size={11} />
            </button>
          )}
        </a>
      ))}
    </div>
  );
}
