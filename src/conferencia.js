// Confere um pedido (já lido pelo parser) contra a planilha de produtos.
// Regra: quantidade × preço da planilha = valor informado na linha.
// Se houver linha "Total", a soma dos itens também precisa bater.
// Com faixas de preço (coluna "A partir de"), o COD usado precisa ser o da faixa da quantidade.

const { normalizarCodigo, formatarReais, formatarQuantidade, formatarQtdUnidade } = require('./util');
const { faixaPara } = require('./catalogo');

/**
 * @param pedido   resultado de parsePedido()
 * @param produtos Map<codigo, {codigo, nome, preco, apartirDe}>
 * @param opcoes   { toleranciaCentavos, exigirTotal }
 */
function conferir(pedido, produtos, opcoes = {}) {
  const tolerancia = opcoes.toleranciaCentavos ?? 0;
  const erros = [...pedido.erros];
  const itens = [];
  let totalCalculado = 0;

  for (const item of pedido.itens) {
    const codigo = normalizarCodigo(item.codigo);
    const informado = produtos.get(codigo);
    if (!informado) {
      erros.push(`COD ${codigo} não existe na planilha ("${item.linha}")`);
      continue;
    }

    const qtdTexto = formatarQtdUnidade(item.quantidade, item.unidade);
    const faixa = faixaPara(produtos, informado, item.quantidade);
    if (!faixa) {
      erros.push(`${qtdTexto} de ${informado.nome}: quantidade fora das faixas da planilha (coluna "A partir de")`);
      continue;
    }
    const produto = faixa;
    if (faixa.codigo !== codigo) {
      erros.push(
        `${qtdTexto} de ${informado.nome} é da faixa COD ${faixa.codigo} (${formatarReais(faixa.preco)} un.), ` +
          `mas o pedido usou COD ${codigo} (${formatarReais(informado.preco)} un.)`
      );
    }

    const esperado = Math.round(item.quantidade * produto.preco);
    totalCalculado += esperado;
    if (faixa.codigo === codigo && Math.abs(esperado - item.valorInformado) > tolerancia) {
      erros.push(
        `${qtdTexto} ${produto.nome}: informado ${formatarReais(item.valorInformado)}, ` +
          `correto ${formatarReais(esperado)} (${formatarQuantidade(item.quantidade)} × ${formatarReais(produto.preco)})`
      );
    }

    itens.push({
      quantidade: item.quantidade,
      unidade: item.unidade,
      codigo: produto.codigo,
      nome: produto.nome,
      precoUnitario: produto.preco,
      valor: esperado,
    });
  }

  // O Total do pedido inclui o frete (linha "Frete: R$..."), quando houver
  const frete = pedido.frete ?? null;
  const subtotal = totalCalculado;
  totalCalculado += frete ?? 0;

  if (pedido.totalInformado === null) {
    if (opcoes.exigirTotal) erros.push('Linha "Total: R$..." ausente');
  } else if (Math.abs(pedido.totalInformado - totalCalculado) > tolerancia && erros.length === 0) {
    erros.push(
      `Total informado ${formatarReais(pedido.totalInformado)}, soma correta dos itens${frete ? ' + frete' : ''} ${formatarReais(totalCalculado)}`
    );
  }

  return {
    ok: erros.length === 0,
    cliente: pedido.cliente,
    entrega: pedido.entrega ?? null,
    itens,
    subtotal,
    frete,
    total: totalCalculado,
    erros,
  };
}

module.exports = { conferir };
