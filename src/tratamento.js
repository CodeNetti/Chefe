// Interpreta pedidos "bagunçados" do grupo Tratamento de Texto e monta o pedido no formato
// que o grupo Pedidos entende. Funções puras (sem WhatsApp), testadas em test/tratamento.test.js.
//
// Cada linha é classificada pelo conteúdo, não por um modelo fixo:
//   cliente   "Alias: X" | "alias X" | "Cliente: X" | "Summary X" | "... para X" no fim de um item
//   item      começa com número: "1g ItemA - 75" | "80g ItemD 21,00" | "24g of ItemD" | "3 tomate para Ana"
//   total     "Total: 25$" | "value: 648" | "total : 75+560=635" (vale o número depois do "=")
//   entrega   "delivery: Station X" | "Station X" | "pickup/station"
//   título    "Order:" | "Pedido" | "Summary" sozinhos -> ignorados
//   nome solto (1 a 4 palavras) -> candidato a cliente
//
// O valor ao lado do item pode ser o preço por unidade OU o total da linha: o sistema escolhe a
// leitura que fecha com o Total informado; sem Total, a mais próxima do preço da planilha.

const { normalizar, normalizarCodigo, paraCentavos, paraQuantidade, formatarReais, formatarQtdUnidade } = require('./util');
const { faixaPara } = require('./catalogo');
const { lerQuantidade, limparLinha, RE_COD, UNIDADES } = require('./parser');

const RE_CABECALHO_WA = /^\[\d{1,2}:\d{2}(?::\d{2})?,\s*\d{1,2}\/\d{1,2}\/\d{2,4}\]\s*[^:]{1,60}:\s?/;
const RE_SO_TITULO = /^(?:order|pedido|pedidos|summary|resumo)\s*:?$/i;
const RE_RESUMO = /^(?:summary|resumo)\s*:?\s+(.+)$/i;
const RE_PREFIXO_PEDIDO = /^(?:order|pedido)\s*:\s*(.+)$/i;
const PALAVRAS_CLIENTE = 'vulgo|alias|apelido|cliente|client|customer|nome|name';
const RE_CLIENTE = new RegExp(`^(?:${PALAVRAS_CLIENTE})\\b\\s*:?\\s*(.+)$`, 'i');
const RE_TOTAL = /^(?:total(?:\s+geral)?|valor(?:\s+total)?|value|soma)\b\s*:?\s*(.*)$/i;
const RE_ENTREGA_CHAVE =
  /^(?:(?:forma|tipo|modo|local)\s+de\s+(?:entrega|retirada)\b\s*:?|(?:entrega|delivery|local|retirada|endere[cç]o|address)\s*:)\s*(.+)$/i;
// Rótulo sozinho na linha: o valor vem na linha de baixo ("VULGO" / "De Di Novo")
const RE_ROTULO_SOZINHO = new RegExp(
  `^(?:(${PALAVRAS_CLIENTE})|((?:forma|tipo|modo|local)\\s+de\\s+(?:entrega|retirada)|entrega|delivery|endere[cç]o)|(total(?:\\s+geral)?|valor(?:\\s+total)?|value))\\s*:?$`,
  'i'
);
// Quantidade depois do produto: "Produto X 10g - 75$" (exige unidade, senão "Produto 75" seria quantidade)
const RE_QTD_DEPOIS = new RegExp(`^(\\D.*?)\\s+(\\d+(?:[.,]\\d+)?\\s?(?:${UNIDADES}))(?=[\\s\\-–—.:/,]|$)\\.?(.*)$`, 'i');
// Início de um novo trecho numa linha com tudo junto ("Vulgo cond$  10g MACA.  Total R$ 270,00")
const RE_INICIO_TRECHO = new RegExp(
  `^(?:${PALAVRAS_CLIENTE}|total|valor\\s+total|value|entrega|delivery|(?:forma|tipo|modo|local)\\s+de\\s+entrega|summary|resumo|order|pedido)\\b`,
  'i'
);
const RE_QTD_NO_MEIO = new RegExp(`^(.*?\\S)\\s+(\\d+(?:[.,]\\d+)?\\s?(?:${UNIDADES})(?=[\\s\\-–—.:/,]).*[a-z].*)$`, 'i');
const RE_TOTAL_NO_MEIO = /^(.*?\S)\s+((?:valor\s+)?total\b.*\d.*)$/i;
const RE_ENTREGA_PALAVRA = /\b(?:station|estacao|delivery|entrega|pickup|retirada|metro)\b/; // em texto normalizado
const RE_PARA = /^(.*?)\s+(?:para|pra|p\/)\s+(?:(?:o|a|os|as)\s+)?(.+)$/i;
const RE_VALOR_FINAL = /^(.*?)(?:\s*[-–—:=>]+\s*|\s+)(?:R\$\s*)?(\d[\d.,]*)\s*(?:R\$|\$|reais)?\s*$/i;
// Produto e valor, sem quantidade: "Alface = R$40,00" (a quantidade sai de valor ÷ preço)
const RE_PRODUTO_VALOR = /^(\D[^=:>]*?)\s*[=:>\-–—]+\s*(?:R\$\s*)?(\d[\d.,]*)\s*(?:R\$|\$|reais)?\s*$/i;
// Frete: "Motoca = 70,00" | "FRETE: Motoca (Rua X 325)" | "Frete: R$ 20"
const RE_FRETE = /^(frete|taxa(?:\s+de\s+entrega)?|motoca|moto|motoboy|uber)\b\s*[:=\-–—]?\s*(.*)$/i;
const RE_DINHEIRO_FINAL = /^(.*?)\s*[-–—:=]*\s*(?:R\$\s*(\d[\d.,]*)|(\d[\d.]*,\d{2}))\s*(?:reais)?\s*$/i;
// Linhas que não são nome de cliente (saudações, avisos de pagamento...)
const RE_NAO_E_NOME =
  /\b(?:salve|bom dia|boa tarde|boa noite|chefe|irmao|mano|obrigad[oa]|valeu|vlw|tmj|opa|ola|oi|pix|pago|paguei|comprovante|blz|beleza|show|fechou|ok|segue)\b|[!?]/;
const RE_EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const RE_CONECTOR = /^(?:of|de|do|da|dos|das)\s+/i;
const NUMEROS_ESCRITOS = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };

// ---------- texto ----------

/** Separa uma colagem de várias mensagens do WhatsApp ("[21:37, 24/11/2026] Fulano: ...") em blocos. */
function dividirMensagens(texto) {
  const blocos = [];
  let atual = [];
  for (const linha of String(texto ?? '').split(/\r?\n/)) {
    const m = linha.match(RE_CABECALHO_WA);
    if (m) {
      if (atual.length) blocos.push(atual.join('\n'));
      atual = [linha.slice(m[0].length)];
    } else {
      atual.push(linha);
    }
  }
  if (atual.length) blocos.push(atual.join('\n'));
  return blocos.filter((b) => b.trim());
}

function aparar(t) {
  return String(t ?? '').replace(/^[\s\-–—:|,.<>=]+|[\s\-–—:|,<>=]+$/g, '').trim();
}

/** Linha de frete -> { entrega, frete } (frete em centavos ou null) | null se não for frete. */
function lerFrete(l) {
  const m = l.match(RE_FRETE);
  if (!m) return null;
  let resto = m[2].trim();
  let frete = null;
  const mDin = resto.match(RE_DINHEIRO_FINAL);
  if (mDin) {
    frete = paraCentavos(mDin[2] || mDin[3]);
    resto = aparar(mDin[1]);
  } else if (/^(?:R\$\s*)?\d[\d.,]*$/.test(resto)) {
    frete = paraCentavos(resto.replace(/R\$/i, ''));
    resto = '';
  }
  const ehVeiculo = !/^(?:frete|taxa)/i.test(m[1]);
  const entrega = [ehVeiculo ? m[1] : null, resto || null].filter(Boolean).join(' ') || null;
  return { entrega, frete };
}

/** "Alface = R$40,00" sem quantidade: deduz a quantidade (valor ÷ preço) quando a conta fecha numa faixa. */
function inferirQuantidade(it, produtos) {
  if (it.quantidade !== null || it.valor === null || !it.grupo) return;
  for (const p of it.grupo.linhas) {
    if (!p.preco) continue;
    const q = it.valor / p.preco;
    const arred = Math.round(q * 100) / 100;
    if (arred > 0 && Math.abs(q - arred) < 1e-6 && faixaPara(produtos, p, arred)?.codigo === p.codigo) {
      it.quantidade = arred;
      it.valorEhTotal = true;
      return;
    }
  }
}

/** Chave de comparação: sem acento, minúscula, sem plural simples ("tomates" -> "tomate"). */
function chave(t) {
  return normalizar(t)
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ');
}

const compacto = (s) => s.replace(/\s+/g, '');

/** Distância de edição com troca de letras vizinhas ("toamte" -> "tomate" = 1). */
function distancia(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + custo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// ---------- produtos ----------

/** Agrupa as linhas da planilha por nome (faixas de preço ficam juntas) com todos os nomes aceitos. */
function indexar(produtos, aprendidos = {}) {
  const grupos = new Map();
  for (const p of produtos.values()) {
    const k = normalizar(p.nome);
    if (!grupos.has(k)) grupos.set(k, { nome: p.nome, linhas: [], chaves: new Set([chave(p.nome)]) });
    const g = grupos.get(k);
    g.linhas.push(p);
    (p.apelidos || []).forEach((a) => g.chaves.add(chave(a)));
  }
  for (const [termo, nome] of Object.entries(aprendidos)) {
    const g = grupos.get(normalizar(nome));
    if (g) g.chaves.add(chave(termo));
  }
  return [...grupos.values()];
}

function contemPalavras(texto, trecho) {
  return trecho.length >= 3 && ` ${texto} `.includes(` ${trecho} `);
}

/**
 * Produtos (grupos) que combinam com o texto: COD, nome/apelido exato, nome contido, ou com 1-2 letras erradas.
 * Retorna [] (não achou), [g] (achou) ou [g1, g2...] (ambíguo).
 */
function acharProduto(texto, idx, produtos, { soExato = false } = {}) {
  const bruto = String(texto ?? '').trim();
  const mCod = bruto.match(RE_COD);
  const codigo = mCod ? mCod[1] : /^[a-z]*\d[a-z0-9]*$/i.test(bruto) ? bruto : null;
  if (codigo) {
    const p = produtos.get(normalizarCodigo(codigo));
    if (p) return idx.filter((g) => g.linhas.includes(p));
  }

  const t = chave(bruto.replace(RE_COD, ' ').replace(/[-–—:|]/g, ' '));
  if (!t) return [];
  const chavesDe = (g) => [...g.chaves];

  const exatos = idx.filter((g) => chavesDe(g).some((c) => c === t || compacto(c) === compacto(t)));
  if (exatos.length || soExato) return exatos;

  const contidos = idx.filter((g) => chavesDe(g).some((c) => contemPalavras(t, c) || contemPalavras(c, t)));
  if (contidos.length) return contidos;

  const tam = compacto(t).length;
  const limite = tam <= 3 ? 0 : tam <= 5 ? 1 : 2;
  let melhor = Infinity;
  let achados = [];
  for (const g of idx) {
    const d = Math.min(...chavesDe(g).map((c) => distancia(compacto(c), compacto(t))));
    if (d < melhor) {
      melhor = d;
      achados = [g];
    } else if (d === melhor) {
      achados.push(g);
    }
  }
  return melhor <= limite ? achados : [];
}

// ---------- linhas ----------

/** Lê uma linha de item. null se não começar com quantidade ou não tiver produto. */
function lerItem(linha) {
  let l = String(linha).trim();
  const [primeira, ...demais] = l.split(/\s+/);
  const escrito = NUMEROS_ESCRITOS[normalizar(primeira)];
  if (escrito && demais.length) l = `${escrito} ${demais.join(' ')}`;

  // "Produto X 10g - 75$" -> "10g Produto X - 75$"
  const mDepois = !/^\d/.test(l) && l.match(RE_QTD_DEPOIS);
  if (mDepois) l = `${mDepois[2]} ${mDepois[1]}${mDepois[3]}`;

  const q = lerQuantidade(l);
  if (!q || q.quantidade === null) return null;

  let resto = q.resto.replace(RE_CONECTOR, '');
  let cliente = null;
  const mPara = resto.match(RE_PARA);
  if (mPara) {
    resto = mPara[1];
    cliente = aparar(mPara[2]);
  }

  let valor = null;
  const mValor = resto.match(RE_VALOR_FINAL);
  if (mValor && aparar(mValor[1])) {
    const v = paraCentavos(mValor[2]);
    if (v !== null) {
      valor = v;
      resto = mValor[1];
    }
  }

  const termo = aparar(resto).replace(/\.+$/, '').trim(); // "MACA." -> "MACA"
  if (!termo || !/[a-z0-9]/i.test(termo)) return null; // "75$" não é item
  return { linha, quantidade: q.quantidade, unidade: q.unidade, termo, valor, cliente, grupo: null, opcoes: [], removido: false };
}

/** A mensagem parece um item de pedido (e não uma resposta curta como "2", "5g" ou "Ana")? */
function pareceItem(texto) {
  const primeira = limparLinha(String(texto ?? '').split(/\r?\n/)[0] || '');
  return !!lerItem(primeira);
}

function lerTotal(texto) {
  let s = String(texto ?? '');
  if (s.includes('=')) s = s.slice(s.lastIndexOf('=') + 1);
  s = s.replace(/\+\s*(?:o\s+)?(?:frete|entrega|taxa|motoca|moto).*$/i, ''); // "2.925,00 + frete"
  s = s.replace(/R\$|\$|reais/gi, '').trim();
  return s ? paraCentavos(s) : null;
}

/**
 * Quebra uma linha que junta várias informações em trechos:
 *   "Vulgo cond$  10g MACA.  Total R$ 270,00" -> ["Vulgo cond$", "10g MACA.", "Total R$ 270,00"]
 * Corta em 2+ espaços só quando o trecho seguinte começa algo novo (rótulo ou item), antes de
 * "Total ..." no meio da linha, e na quantidade que vem depois do nome do cliente.
 */
function dividirTrechos(linha) {
  const trechos = [];
  for (const p of linha.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean)) {
    if (!trechos.length || RE_INICIO_TRECHO.test(p) || lerItem(p)) trechos.push(p);
    else trechos[trechos.length - 1] += ` ${p}`;
  }
  const saida = [];
  for (let t of trechos) {
    const partes = [];
    let m;
    if (!RE_TOTAL.test(t) && (m = t.match(RE_TOTAL_NO_MEIO))) {
      t = m[1];
      partes.push(m[2]);
    }
    if ((RE_CLIENTE.test(t) || RE_RESUMO.test(t)) && (m = t.match(RE_QTD_NO_MEIO))) {
      t = m[1];
      partes.unshift(m[2]);
    }
    saida.push(t, ...partes);
  }
  return saida;
}

function pareceNome(l) {
  return (
    !/^\d/.test(l) &&
    l.length <= 40 &&
    l.split(/\s+/).length <= 4 &&
    !/[:=$]/.test(l) &&
    /[a-z]/i.test(l) &&
    !RE_NAO_E_NOME.test(normalizar(l))
  );
}

// ---------- interpretação ----------

/**
 * Interpreta UM bloco (uma mensagem).
 * opts.aprendidos: { termo: nomeDoProduto } | opts.contatos: [nomes da agenda] (desempata o cliente)
 */
function interpretar(texto, produtos, { aprendidos = {}, contatos = null } = {}) {
  const idx = indexar(produtos, aprendidos);
  const itens = [];
  const candidatos = [];
  const entrega = [];
  const ignoradas = [];
  let clienteExplicito = null;
  let totalInformado = null;
  let totalMaisFrete = false; // "total R$ 2.925,00 + frete": o total não inclui o frete
  let frete = null;
  let rotulo = null; // 'cliente' | 'entrega' | 'total': o valor está na próxima linha

  const linhas = String(texto ?? '')
    .split(/\r?\n/)
    .flatMap((bruta) => dividirTrechos(limparLinha(bruta).replace(RE_EMOJI, '').trim()));
  for (let l of linhas) {
    if (!l || RE_SO_TITULO.test(l)) continue;
    let m;

    if ((m = l.match(RE_ROTULO_SOZINHO))) {
      rotulo = m[1] ? 'cliente' : m[2] ? 'entrega' : 'total';
      continue;
    }
    const doRotulo = rotulo;
    rotulo = null;
    if (doRotulo && !lerItem(l)) {
      if (doRotulo === 'cliente') {
        clienteExplicito ??= aparar(l);
        continue;
      }
      if (doRotulo === 'entrega') {
        entrega.push(l);
        continue;
      }
      const t = lerTotal(l);
      if (t !== null) {
        totalInformado = t;
        continue;
      }
    }

    if ((m = l.match(RE_RESUMO))) {
      const resto = aparar(m[1]);
      const mCli = resto.match(RE_CLIENTE); // "Resumo: Vulgo Fulano"
      clienteExplicito ??= mCli ? aparar(mCli[1]) : resto;
      continue;
    }
    if ((m = l.match(RE_PREFIXO_PEDIDO))) l = m[1].trim();
    if ((m = l.match(RE_CLIENTE))) {
      clienteExplicito ??= aparar(m[1]);
      continue;
    }
    if ((m = l.match(RE_TOTAL))) {
      const t = lerTotal(m[1]);
      if (t !== null) {
        totalInformado = t;
        totalMaisFrete = /\+\s*(?:o\s+)?(?:frete|entrega|taxa|motoca|moto)/i.test(m[1]);
      } else ignoradas.push(l);
      continue;
    }
    const f = lerFrete(l);
    if (f) {
      if (f.entrega) entrega.push(f.entrega);
      if (f.frete !== null) frete = f.frete;
      continue;
    }
    if ((m = l.match(RE_ENTREGA_CHAVE))) {
      entrega.push(m[1].trim());
      continue;
    }

    const item = lerItem(l);
    if (item) {
      itens.push(item);
      continue;
    }
    // "Alface = R$40,00": produto com valor, sem quantidade
    if ((m = l.match(RE_PRODUTO_VALOR))) {
      const termo = aparar(m[1]);
      const valor = paraCentavos(m[2]);
      const achados = valor !== null ? acharProduto(termo, idx, produtos) : [];
      if (achados.length === 1) {
        itens.push({ linha: l, quantidade: null, unidade: 'x', termo, valor, cliente: null, grupo: achados[0], opcoes: [], removido: false });
        continue;
      }
    }
    if (RE_ENTREGA_PALAVRA.test(normalizar(l))) {
      entrega.push(l);
      continue;
    }
    const soProduto = acharProduto(l, idx, produtos, { soExato: true });
    if (soProduto.length === 1) {
      itens.push({ linha: l, quantidade: null, unidade: 'x', termo: l, valor: null, cliente: null, grupo: soProduto[0], opcoes: [], removido: false });
      continue;
    }
    if (pareceNome(l)) candidatos.push(l);
    else ignoradas.push(l);
  }

  for (const it of itens) {
    if (it.grupo) continue;
    it.opcoes = acharProduto(it.termo, idx, produtos);
    if (it.opcoes.length === 1) it.grupo = it.opcoes[0];
  }
  for (const it of itens) inferirQuantidade(it, produtos);

  // Cliente: explícito > nome solto único > nome solto que está na agenda > pergunta
  let clienteGeral = clienteExplicito;
  let opcoesCliente = [];
  const unicos = [...new Set(candidatos)];
  if (!clienteGeral && itens.some((i) => !i.cliente)) {
    let c = unicos;
    if (c.length > 1 && contatos?.length) {
      const agenda = new Set(contatos.map(normalizar));
      const naAgenda = c.filter((x) => agenda.has(normalizar(x)));
      if (naAgenda.length) c = naAgenda;
    }
    if (c.length === 1) clienteGeral = c[0];
    else opcoesCliente = c;
  }
  ignoradas.push(...unicos.filter((c) => c !== clienteGeral && !opcoesCliente.includes(c)));

  return {
    itens,
    clienteGeral,
    opcoesCliente,
    totalInformado: totalInformado !== null && totalMaisFrete && frete !== null ? totalInformado + frete : totalInformado,
    frete,
    entrega: entrega.join(' / ') || null,
    ignoradas,
    cancelado: false,
  };
}

/** Divide a colagem e interpreta cada mensagem. Só devolve as que têm itens. */
function interpretarTudo(texto, produtos, opts) {
  return dividirMensagens(texto)
    .map((b) => interpretar(b, produtos, opts))
    .filter((r) => r.itens.length);
}

// ---------- perguntas e respostas ----------

/** O que falta para montar o pedido: produto, quantidade ou cliente. null = pronto. */
function proximaPendencia(r) {
  if (r.cancelado) return null;
  const ativos = r.itens.map((it, i) => ({ it, i })).filter(({ it }) => !it.removido);
  const semProduto = ativos.find(({ it }) => !it.grupo);
  if (semProduto) return { tipo: 'produto', i: semProduto.i, opcoes: semProduto.it.opcoes.slice(0, 8) };
  const semQtd = ativos.find(({ it }) => it.quantidade === null);
  if (semQtd) return { tipo: 'quantidade', i: semQtd.i };
  if (!r.clienteGeral && ativos.some(({ it }) => !it.cliente)) return { tipo: 'cliente', opcoes: r.opcoesCliente };
  return null;
}

/**
 * Aplica a resposta do grupo à pendência.
 * Retorna { ok: true, apelido?: {termo, nome} } ou { ok: false, erro }.
 */
function aplicarResposta(r, pend, texto, produtos, aprendidos = {}) {
  const t = limparLinha(String(texto ?? '').split(/\r?\n/)[0] || '');
  if (!t) return { ok: false, erro: 'Resposta vazia' };
  const opcao = /^\d{1,2}$/.test(t) ? Number(t) : null;

  if (t === '0') {
    if (pend.tipo === 'cliente') r.cancelado = true;
    else r.itens[pend.i].removido = true;
    if (r.itens.every((i) => i.removido)) r.cancelado = true;
    return { ok: true };
  }

  if (pend.tipo === 'produto') {
    const it = r.itens[pend.i];
    let g = null;
    if (opcao && pend.opcoes.length) {
      g = pend.opcoes[opcao - 1] ?? null;
      if (!g) return { ok: false, erro: `Opção ${opcao} não existe. Responda de 1 a ${pend.opcoes.length}, com o COD ou com o nome do produto.` };
    } else {
      const achados = acharProduto(t, indexar(produtos, aprendidos), produtos);
      if (achados.length === 1) g = achados[0];
      else if (achados.length > 1) return { ok: false, erro: `"${t}" combina com: ${achados.map((a) => a.nome).join(', ')}. Responda com o COD ou o nome completo.` };
      else return { ok: false, erro: `Não encontrei "${t}" na planilha. Responda com o COD ou o nome do produto como está na planilha.` };
    }
    it.grupo = g;
    inferirQuantidade(it, produtos);
    const termo = chave(it.termo);
    const ehCodigo = /\d/.test(it.termo) && produtos.has(normalizarCodigo(it.termo));
    const apelido = termo && !ehCodigo && !g.chaves.has(termo) ? { termo, nome: g.nome } : null;
    return { ok: true, apelido };
  }

  if (pend.tipo === 'quantidade') {
    const q = lerQuantidade(t);
    if (!q || q.quantidade === null) return { ok: false, erro: 'Responda com a quantidade (ex.: 5 ou 5g), ou 0 para tirar o item.' };
    r.itens[pend.i].quantidade = q.quantidade;
    r.itens[pend.i].unidade = q.unidade;
    return { ok: true };
  }

  // cliente
  if (opcao && pend.opcoes.length) {
    const nome = pend.opcoes[opcao - 1];
    if (!nome) return { ok: false, erro: `Opção ${opcao} não existe. Responda de 1 a ${pend.opcoes.length} ou com o nome do cliente.` };
    r.clienteGeral = nome;
  } else {
    r.clienteGeral = aparar(t.replace(/^(?:cliente|alias)\s*:?\s*/i, ''));
  }
  return { ok: true };
}

// ---------- montagem ----------

/** Monta o(s) pedido(s) no formato do grupo Pedidos (um por cliente). Exige pendências resolvidas. */
function montarPedidos(r, produtos) {
  if (r.cancelado) return [];
  const calc = r.itens
    .filter((it) => !it.removido)
    .map((it) => {
      const base = it.grupo.linhas.slice().sort((a, b) => (a.apartirDe ?? 0) - (b.apartirDe ?? 0))[0];
      const produto = faixaPara(produtos, base, it.quantidade) || base;
      return {
        it,
        produto,
        esperado: Math.round(it.quantidade * produto.preco),
        porUnidade: it.valor === null ? null : it.valorEhTotal ? it.valor : Math.round(it.quantidade * it.valor),
      };
    });

  // Valor por unidade ou total da linha? Primeiro tenta fechar com o Total informado (sem o frete).
  let modo = null;
  const alvo = r.totalInformado === null ? null : r.totalInformado - (r.frete ?? 0);
  if (alvo !== null && calc.some((c) => c.it.valor !== null && c.it.quantidade !== 1)) {
    const soma = (f) => calc.reduce((s, c) => s + (c.it.valor === null ? c.esperado : f(c)), 0);
    if (Math.abs(soma((c) => c.porUnidade) - alvo) <= 1) modo = 'unidade';
    else if (Math.abs(soma((c) => c.it.valor) - alvo) <= 1) modo = 'linha';
  }
  for (const c of calc) {
    const { it } = c;
    if (it.valor === null) c.valorLinha = c.esperado;
    else if (it.valorEhTotal || it.quantidade === 1 || modo === 'linha') c.valorLinha = it.valor;
    else if (modo === 'unidade') c.valorLinha = c.porUnidade;
    else c.valorLinha = Math.abs(c.porUnidade - c.esperado) < Math.abs(it.valor - c.esperado) ? c.porUnidade : it.valor;
  }

  const porCliente = new Map();
  for (const c of calc) {
    const cliente = c.it.cliente || r.clienteGeral;
    if (!porCliente.has(cliente)) porCliente.set(cliente, []);
    porCliente.get(cliente).push(c);
  }
  const umSo = porCliente.size === 1;

  return [...porCliente].map(([cliente, cs]) => {
    const linhas = [
      `Cliente: ${cliente}`,
      'Pedido',
      ...cs.map(
        (c) =>
          `${formatarQtdUnidade(c.it.quantidade, c.it.unidade)} - ${c.produto.nome} - COD:${c.produto.codigo} - ${formatarReais(c.valorLinha)}`
      ),
    ];
    if (r.entrega) linhas.push(`Entrega: ${r.entrega}`);
    if (umSo && r.frete) linhas.push(`Frete: ${formatarReais(r.frete)}`);
    if (umSo && r.totalInformado !== null) linhas.push(`Total: ${formatarReais(r.totalInformado)}`);
    return { cliente, texto: linhas.join('\n') };
  });
}

module.exports = {
  dividirMensagens,
  interpretar,
  interpretarTudo,
  proximaPendencia,
  aplicarResposta,
  montarPedidos,
  pareceItem,
  acharProduto,
  indexar,
  distancia,
};
