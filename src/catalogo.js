// Carrega a planilha de produtos (COD - Nome - Preço).
// A planilha é relida automaticamente quando o arquivo é alterado,
// então dá para atualizar preços sem reiniciar o sistema.
//
// Colunas opcionais:
// - "A partir de": faixas de preço. Cada faixa é uma linha com o MESMO Nome e COD próprio.
//     1010 | Produto X | A partir de 0  | 80
//     1020 | Produto X | A partir de 50 | 70
//   Para uma quantidade, vale a faixa de maior "A partir de" que seja <= quantidade.
// - "Apelidos": outros nomes do produto, separados por vírgula (usados no grupo Tratamento de Texto).

const fs = require('fs');
const ExcelJS = require('exceljs');
const { normalizar, normalizarCodigo, paraCentavos, log } = require('./util');

const CABECALHOS = {
  codigo: ['cod', 'codigo', 'cod.', 'código'],
  nome: ['nome', 'produto', 'descricao', 'descrição'],
  preco: ['preco', 'preço', 'valor', 'preco unitario', 'preço unitário', 'valor unitario'],
  apartirDe: ['a partir de', 'apartir de', 'qtd minima', 'quantidade minima', 'minimo', 'faixa'],
  apelidos: ['apelidos', 'apelido', 'sinonimos', 'outros nomes'],
};

/** Extrai o valor "puro" de uma célula do ExcelJS (fórmula, rich text, hyperlink...). */
function valorCelula(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if ('result' in v) return v.result; // fórmula
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return v.text; // hyperlink
    if (v instanceof Date) return v.toISOString();
  }
  return v;
}

function identificarColunas(row) {
  const colunas = {};
  row.eachCell((cell, col) => {
    const h = normalizar(valorCelula(cell));
    for (const [campo, nomes] of Object.entries(CABECALHOS)) {
      if (!colunas[campo] && nomes.map(normalizar).includes(h)) colunas[campo] = col;
    }
  });
  return colunas.codigo && colunas.nome && colunas.preco ? colunas : null;
}

/** "50" | 50 | "50g" | "" -> 50 | null (aceita 0). */
function lerMinimo(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const m = String(v).replace(',', '.').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

async function lerPlanilha(caminho) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(caminho);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('A planilha não tem nenhuma aba');

  // Procura a linha de cabeçalho nas 10 primeiras linhas
  let colunas = null;
  let linhaCabecalho = 0;
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    colunas = identificarColunas(ws.getRow(r));
    if (colunas) {
      linhaCabecalho = r;
      break;
    }
  }
  if (!colunas) {
    throw new Error('Cabeçalho não encontrado. A planilha precisa das colunas COD, Nome e Preço');
  }

  const produtos = new Map();
  const avisos = [];
  for (let r = linhaCabecalho + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const codigoBruto = valorCelula(row.getCell(colunas.codigo));
    if (codigoBruto === null || String(codigoBruto).trim() === '') continue;

    const codigo = normalizarCodigo(codigoBruto);
    const nome = String(valorCelula(row.getCell(colunas.nome)) ?? '').trim();
    const preco = paraCentavos(valorCelula(row.getCell(colunas.preco)));

    if (preco === null) {
      avisos.push(`Linha ${r}: preço inválido para COD ${codigo}`);
      continue;
    }
    if (produtos.has(codigo)) avisos.push(`Linha ${r}: COD ${codigo} duplicado (vale a última linha)`);
    const apartirDe = colunas.apartirDe ? lerMinimo(valorCelula(row.getCell(colunas.apartirDe))) : null;
    const apelidos = colunas.apelidos
      ? String(valorCelula(row.getCell(colunas.apelidos)) ?? '')
          .split(/[,;\n]/)
          .map((a) => a.trim())
          .filter(Boolean)
      : [];
    produtos.set(codigo, { codigo, nome: nome || `COD ${codigo}`, preco, apartirDe, apelidos });
  }
  return { produtos, avisos };
}

/** Todas as linhas (faixas) com o mesmo nome do produto. */
function faixasDe(produtos, nome) {
  const alvo = normalizar(nome);
  return [...produtos.values()].filter((p) => normalizar(p.nome) === alvo);
}

/**
 * Faixa certa de um produto para a quantidade.
 * Sem coluna "A partir de" preenchida para esse nome -> o próprio produto.
 * Quantidade abaixo de todas as faixas -> null.
 */
function faixaPara(produtos, produto, quantidade) {
  const irmaos = faixasDe(produtos, produto.nome);
  if (!irmaos.some((p) => p.apartirDe !== null && p.apartirDe !== undefined)) return produto;
  const validas = irmaos
    .filter((p) => (p.apartirDe ?? 0) <= quantidade)
    .sort((a, b) => (b.apartirDe ?? 0) - (a.apartirDe ?? 0));
  return validas[0] ?? null;
}

class Catalogo {
  constructor(caminho) {
    this.caminho = caminho;
    this.produtos = null;
    this.mtime = 0;
  }

  /** Retorna o Map de produtos, recarregando se o arquivo mudou. */
  async obter() {
    const stat = fs.statSync(this.caminho); // lança erro se o arquivo não existir
    if (!this.produtos || stat.mtimeMs !== this.mtime) {
      const { produtos, avisos } = await lerPlanilha(this.caminho);
      avisos.forEach((a) => log('⚠️  Planilha:', a));
      this.produtos = produtos;
      this.mtime = stat.mtimeMs;
      log(`📦 Planilha carregada: ${produtos.size} produtos`);
    }
    return this.produtos;
  }
}

module.exports = { Catalogo, lerPlanilha, faixasDe, faixaPara };
