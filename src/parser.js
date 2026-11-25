// Lê o texto de uma mensagem do grupo e extrai o pedido.
//
// Formato esperado (maiúsculas/minúsculas e espaços extras são tolerados):
//
//   Cliente: Gustavo
//   Pedido
//   2x - Alface - COD:2121 - R$80,00
//   3x - Tomate - COD:1010 - R$22,50
//   Total: R$102,50
//
// - A 1ª linha SEMPRE começa com "Cliente:" (é o nome do contato salvo no WhatsApp).
// - A linha "Pedido" é opcional.
// - Em cada item, o valor (R$) é o TOTAL DA LINHA (quantidade × preço unitário).
// - O nome do produto no item é opcional e apenas informativo: a conferência é feita pelo COD.
// - A linha "Total" é opcional (pode ser obrigatória via config "exigirTotal").
// - A linha "Enviar para: <telefone ou nome do contato>" é opcional: força o destinatário
//   em vez de procurar pelo nome do cliente.
//
// Mensagens cuja 1ª linha não começa com "Cliente:" NÃO são pedidos e são ignoradas
// (retorna null). É assim que o sistema ignora conversas comuns e as próprias respostas.

const { paraCentavos, paraQuantidade } = require('./util');

const RE_CLIENTE = /^cliente\s*:?\s*(.+)$/i;
const RE_PEDIDO = /^pedidos?\s*:?$/i;
const RE_DESTINO = /^(?:enviar\s+para|mandar\s+para|destino)\s*:?\s*(.+)$/i;
const RE_TOTAL = /^total(?:\s+geral)?\s*:?\s*(?:R\$)?\s*([\d.,]+)\s*$/i;
const RE_ENTREGA = /^(?:entrega|local\s+de\s+entrega|delivery)\s*:\s*(.+)$/i;

// Quantidade + unidade opcional. O que vale para a conta é o número; a unidade só é exibida.
//   "2x" "5g" "10m" "1,5kg" "3 un" "10 m" "3" (sem unidade = "x")
// Unidade colada no número pode ser qualquer palavra curta; separada por espaço, só as conhecidas
// (senão "2 Uva" leria "Uva" como unidade).
const UNIDADES = 'x|un|und|unid|unidades?|g|gr|grs|gramas?|kg|kgs|mg|m|cm|mm|ml|l|lt|lts|litros?|cx|caixas?|pct|pcts|pacotes?|pc|pcs|dz|duzias?';
const FIM_UNIDADE = '(?=[\\s\\-–—.:/,]|$)';
const RE_ITEM_INICIO = new RegExp(
  `^(\\d+(?:[.,]\\d+)?)(?:(${UNIDADES}|[a-zµ]{1,5})${FIM_UNIDADE}|\\s+(${UNIDADES})${FIM_UNIDADE})?\\.?\\s*(?:[-–—]\\s*)?(.*)$`,
  'i'
);

/** "5g Queijo" -> { quantidade: 5, unidade: "g", resto: "Queijo" } | null */
function lerQuantidade(linha) {
  const m = String(linha).match(RE_ITEM_INICIO);
  if (!m) return null;
  return {
    quantidade: paraQuantidade(m[1]),
    unidade: (m[2] || m[3] || 'x').toLowerCase(),
    resto: m[4].trim(),
  };
}
const RE_COD = /\bcod(?:igo)?\s*[:.]?\s*([A-Za-z0-9]+)/i;
const RE_VALOR = /R\$\s*([\d.,]+)\s*$/i;

/** Remove marcações de formatação do WhatsApp (*negrito*, _itálico_, ~riscado~) e padroniza traços. */
function limparLinha(linha) {
  return linha.replace(/[*_~`]/g, '').replace(/[−‐‑]/g, '-').trim();
}

function parsePedido(texto) {
  const linhas = String(texto ?? '')
    .split(/\r?\n/)
    .map(limparLinha)
    .filter(Boolean);

  if (linhas.length === 0) return null;
  const mCliente = linhas[0].match(RE_CLIENTE);
  if (!mCliente) return null; // não é pedido

  const pedido = {
    cliente: mCliente[1].trim(),
    itens: [],
    totalInformado: null,
    destino: null,
    entrega: null,
    erros: [],
  };

  for (const linha of linhas.slice(1)) {
    if (RE_PEDIDO.test(linha)) continue;

    const mEntrega = linha.match(RE_ENTREGA);
    if (mEntrega) {
      pedido.entrega = mEntrega[1].trim();
      continue;
    }

    const mDestino = linha.match(RE_DESTINO);
    if (mDestino) {
      pedido.destino = mDestino[1].trim();
      continue;
    }

    const mTotal = linha.match(RE_TOTAL);
    if (mTotal) {
      const total = paraCentavos(mTotal[1]);
      if (total === null) pedido.erros.push(`Total ilegível: "${linha}"`);
      else pedido.totalInformado = total;
      continue;
    }

    const mItem = lerQuantidade(linha);
    if (mItem) {
      const qtd = mItem.quantidade;
      const resto = mItem.resto;
      const mCod = resto.match(RE_COD);
      const mValor = resto.match(RE_VALOR);
      const problemas = [];
      if (qtd === null) problemas.push('quantidade inválida');
      if (!mCod) problemas.push('COD ausente');
      if (!mValor) problemas.push('valor R$ ausente');
      const valor = mValor ? paraCentavos(mValor[1]) : null;
      if (mValor && valor === null) problemas.push('valor R$ ilegível');

      if (problemas.length) {
        pedido.erros.push(`Item com ${problemas.join(', ')}: "${linha}"`);
        continue;
      }

      // Nome informado = o que estiver entre a quantidade e o COD (só para referência)
      const nomeInformado = resto
        .slice(0, mCod.index)
        .replace(/[-–—|]+/g, ' ')
        .trim();

      pedido.itens.push({
        linha,
        quantidade: qtd,
        unidade: mItem.unidade,
        codigo: mCod[1],
        nomeInformado,
        valorInformado: valor,
      });
      continue;
    }

    pedido.erros.push(`Linha não reconhecida: "${linha}"`);
  }

  if (!pedido.cliente) pedido.erros.push('Nome do cliente vazio na 1ª linha');
  if (pedido.itens.length === 0) pedido.erros.push('Nenhum item encontrado no pedido');

  return pedido;
}

module.exports = { parsePedido, lerQuantidade, limparLinha, RE_COD };
