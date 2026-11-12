/* ══════════════════════════════════════════════════════════════════════════
 * UMA MEMÓRIA POR EMPRESA — sempre
 *
 * O modelo é o mesmo pra todo mundo; a memória é de UMA empresa só. Até aqui
 * isso era verdade por acaso: nada no banco dizia de quem a memória era, e
 * duas instalações apontadas pro mesmo MONGODB_OFFICE_DB misturariam as
 * memórias sem erro nenhum — o orquestrador de uma lendo as decisões da outra.
 *
 * Três travas:
 *  1. CARIMBO. O banco do escritório nasce com `office_config {id:'empresa'}`
 *     (id + nome). Quem sobe depois com outro nome, ou outro EMPRESA_ID, é
 *     barrado no boot — melhor não subir do que subir lendo a empresa errada.
 *  2. TODA memória carrega `empresaId`. Doc sem carimbo (anterior a isto) é
 *     adotado no boot; doc de OUTRA empresa barra o boot (restore errado).
 *  3. Toda leitura e escrita passa por `colecaoDaEmpresa`, que injeta o
 *     `empresaId` no filtro. Ninguém consulta `office_memories` cru.
 * ══════════════════════════════════════════════════════════════════════════ */
const crypto = require("node:crypto");

const COLECAO = "office_memories";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/* Carimba (ou confere) o banco. Devolve { id, nome }. Lança se o banco for de
   outra empresa — o chamador NÃO deve subir o serviço nesse caso. */
async function carimbarEmpresa(db, { nome, idFixo } = {}) {
  const cfg = db.collection("office_config");
  const fixo = String(idFixo || "").trim();
  let carimbo = await cfg.findOne({ id: "empresa" });

  if (!carimbo) {
    carimbo = { id: "empresa", empresaId: fixo || crypto.randomUUID(), nome, criadaEm: new Date() };
    // upsert com $setOnInsert: duas instâncias subindo juntas ficam com o MESMO carimbo
    await cfg.updateOne({ id: "empresa" }, { $setOnInsert: carimbo }, { upsert: true });
    carimbo = await cfg.findOne({ id: "empresa" });
  }

  if (fixo && carimbo.empresaId !== fixo) {
    throw new Error(`Este banco do escritório é da empresa "${carimbo.nome}" (EMPRESA_ID=${carimbo.empresaId}), não de EMPRESA_ID=${fixo}. Aponte MONGODB_OFFICE_DB pra um banco seu.`);
  }
  if (norm(carimbo.nome) !== norm(nome)) {
    // renomear é legítimo, mas tem que ser de propósito: o EMPRESA_ID certo confirma
    if (fixo !== carimbo.empresaId) {
      throw new Error(`Este banco do escritório é da empresa "${carimbo.nome}", e esta instalação se chama "${nome}". Se é a mesma empresa com nome novo, ponha EMPRESA_ID=${carimbo.empresaId} no .env. Se não é, aponte MONGODB_OFFICE_DB pra um banco seu.`);
    }
    await cfg.updateOne({ id: "empresa" }, { $set: { nome, renomeadaEm: new Date() } });
  }

  const empresaId = carimbo.empresaId;
  const col = db.collection(COLECAO);
  const estranhas = await col.countDocuments({ empresaId: { $exists: true, $ne: empresaId } });
  if (estranhas) {
    throw new Error(`${estranhas} memória(s) de OUTRA empresa em ${COLECAO} — provavelmente um restore do backup errado. Nada foi apagado; resolva antes de subir.`);
  }
  // memória anterior ao carimbo é desta empresa: era o único dono possível
  await col.updateMany({ empresaId: { $exists: false } }, { $set: { empresaId } });

  await Promise.all([
    col.createIndex({ empresaId: 1, id: 1 }, { unique: true }),
    col.createIndex({ empresaId: 1, status: 1 }),
    col.createIndex({ empresaId: 1, "escopo.cliente": 1 }),
    col.createIndex({ empresaId: 1, updatedAt: -1 }),
  ]).catch((e) => console.warn("memória: índice não criado —", e.message));

  return { id: empresaId, nome: nome || carimbo.nome };
}

/* `office_memories` com o empresaId sempre no filtro. Só os métodos que o
   código usa — método novo entra aqui, não em `db.collection(...)` cru. */
function colecaoDaEmpresa(db, empresaId) {
  if (!empresaId) throw new Error("memória sem empresa: carimbarEmpresa() não rodou");
  const col = db.collection(COLECAO);
  const f = (filtro = {}) => ({ ...filtro, empresaId });
  return {
    find: (filtro, opts) => col.find(f(filtro), opts),
    findOne: (filtro, opts) => col.findOne(f(filtro), opts),
    countDocuments: (filtro, opts) => col.countDocuments(f(filtro), opts),
    insertOne: (doc, opts) => col.insertOne({ ...doc, empresaId }, opts),
    updateOne: (filtro, upd, opts) => col.updateOne(f(filtro), upd, opts),
    updateMany: (filtro, upd, opts) => col.updateMany(f(filtro), upd, opts),
    deleteOne: (filtro, opts) => col.deleteOne(f(filtro), opts),
    aggregate: (pipeline = [], opts) => col.aggregate([{ $match: { empresaId } }, ...pipeline], opts),
    bulkWrite: (ops, opts) => col.bulkWrite(ops.map((op) => {
      const [tipo, corpo] = Object.entries(op)[0];
      if (tipo === "insertOne") return { insertOne: { document: { ...corpo.document, empresaId } } };
      return { [tipo]: { ...corpo, filter: f(corpo.filter) } };
    }), opts),
  };
}

module.exports = { carimbarEmpresa, colecaoDaEmpresa, COLECAO };
