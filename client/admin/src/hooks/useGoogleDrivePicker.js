import { useCallback, useEffect, useRef, useState } from "react";

/* ══════════════════════════════════════════════════════════
   useGoogleDrivePicker
   
   Abre o Google Picker pra escolher arquivo do Drive do usuário.
   Usa auth própria (prompt separado do login do admin) pra pegar
   token com scope drive.file (acesso apenas a arquivos escolhidos).
   
   Requer vars de ambiente (prefixo VITE_):
     VITE_GOOGLE_CLIENT_ID
     VITE_GOOGLE_API_KEY
     VITE_GOOGLE_APP_ID  (project number do Google Cloud)
   ══════════════════════════════════════════════════════════ */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const APP_ID = import.meta.env.VITE_GOOGLE_APP_ID;
const SCOPES = "https://www.googleapis.com/auth/drive.file";

// Carrega um script uma única vez
const scriptCache = new Map();
function loadScript(src) {
  if (scriptCache.has(src)) return scriptCache.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  scriptCache.set(src, p);
  return p;
}

let gisTokenClient = null;
let cachedToken = null;

export function useGoogleDrivePicker({ onPick } = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  // Config check
  const configured = !!(CLIENT_ID && API_KEY && APP_ID);

  // Carrega scripts do GIS (Google Identity Services) e do Picker
  const ensureLoaded = useCallback(async () => {
    await Promise.all([
      loadScript("https://accounts.google.com/gsi/client"),
      loadScript("https://apis.google.com/js/api.js"),
    ]);

    // Carrega o módulo picker do gapi
    await new Promise((resolve, reject) => {
      window.gapi.load("picker", { callback: resolve, onerror: reject });
    });

    // Cria token client (se ainda não foi criado)
    if (!gisTokenClient && window.google?.accounts?.oauth2) {
      gisTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: "", // definido em tempo de execução
      });
    }
  }, []);

  // Pede token de acesso ao Drive
  const requestToken = useCallback(() => {
    return new Promise((resolve, reject) => {
      if (!gisTokenClient) return reject(new Error("GIS não inicializado"));
      gisTokenClient.callback = (response) => {
        if (response.error) return reject(new Error(response.error));
        cachedToken = response.access_token;
        resolve(response.access_token);
      };
      // Se tiver token em cache, tenta usar sem prompt
      gisTokenClient.requestAccessToken({ prompt: cachedToken ? "" : "consent" });
    });
  }, []);

  // Abre o Picker
  const open = useCallback(async () => {
    if (!configured) {
      setError("Google Picker não configurado — falta VITE_GOOGLE_CLIENT_ID / API_KEY / APP_ID");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await ensureLoaded();
      const token = await requestToken();

      const view = new window.google.picker.DocsView()
        .setIncludeFolders(true)
        .setSelectFolderEnabled(false);

      const picker = new window.google.picker.PickerBuilder()
        .addView(view)
        .addView(new window.google.picker.DocsUploadView())
        .setOAuthToken(token)
        .setDeveloperKey(API_KEY)
        .setAppId(APP_ID)
        .setLocale("pt-BR")
        .setCallback((data) => {
          if (data.action === window.google.picker.Action.PICKED) {
            const docs = data.docs || [];
            docs.forEach(doc => {
              onPickRef.current?.({
                fileId: doc.id,
                name: doc.name,
                url: doc.url || `https://drive.google.com/open?id=${doc.id}`,
                iconUrl: doc.iconUrl || "",
                mimeType: doc.mimeType || "",
                thumbnailUrl: (doc.thumbnails && doc.thumbnails[0]?.url) || "",
              });
            });
          }
        })
        .build();
      picker.setVisible(true);
    } catch (e) {
      console.error("Picker error:", e);
      setError(e.message || "Erro ao abrir Google Picker");
    } finally {
      setLoading(false);
    }
  }, [configured, ensureLoaded, requestToken]);

  return { open, loading, error, configured };
}