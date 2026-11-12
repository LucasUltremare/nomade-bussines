/* Canais de atendimento. Cada conector vive no próprio arquivo e segue o
   mesmo contrato (ver mercadolivre.js). Canal novo = arquivo novo + linha aqui. */
import * as mercadolivre from "./mercadolivre.js";
import * as shopee from "./shopee.js";

export const CANAIS = [mercadolivre, shopee];
export const canalPorId = (id) => CANAIS.find((c) => c.id === id) || null;

/* "teste" é o canal de ensaio: a pessoa escreve como se fosse o cliente e vê
   a IA responder com as memórias, sem conectar nada. */
export const CANAL_TESTE = "teste";

export const MODOS = ["manual", "sugerir", "automatico"];

/* config do canal → o que a tela pode ver: segredo vira máscara */
export function publico(conector, doc = {}) {
  const cfg = doc.cfg || {};
  return {
    id: conector.id,
    nome: conector.nome,
    precisaHttps: !!conector.precisaHttps,
    campos: conector.campos.map((c) => ({
      ...c,
      valor: c.tipo === "secret" ? (cfg[c.k] ? `••••${String(cfg[c.k]).slice(-4)}` : "") : (cfg[c.k] ?? c.padrao ?? ""),
      preenchido: !!cfg[c.k],
    })),
    configurado: conector.campos.filter((c) => c.tipo !== "select").every((c) => !!cfg[c.k]),
    conectado: !!doc.tokens?.access,
    conta: doc.conta || null,
    ativo: doc.ativo !== false,
    modo: MODOS.includes(doc.modo) ? doc.modo : "sugerir",
    limiar: typeof doc.limiar === "number" ? doc.limiar : 0.85,
    aprender: doc.aprender !== false,
    ultimaSync: doc.ultimaSync || null,
    erro: doc.erro || null,
  };
}
