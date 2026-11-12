# Painel do Nomade Business

React + Vite. Build em `dist/`, servido pelo `server.js` em `/admin` e aberto
pelo `ai-service.js` na raiz do `PAINEL_URL`.

```bash
npm install
npm run dev      # http://localhost:5173 — com proxy pro ai-service em :5004
npm run build    # gera dist/
```

Em dev, suba antes o `server.js` (porta 5002) e o `ai-service.js` (porta 5004)
na raiz do repositório.
