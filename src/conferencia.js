// Confere um pedido (já lido pelo parser) contra a planilha de produtos.
// Regra: quantidade × preço da planilha = valor informado na linha.
// Se houver linha "Total", a soma dos itens também precisa bater.

const { normalizarCodigo, formatarReais, formatarQuantidade } = require('./util');

/**
 * @param pedido   resultado de parsePedido()
 * @param produtos Map<codigo, {codigo, nome, preco}>
 * @param opcoes   { toleranciaCentavos, exigirTotal }
 */
function conferir(pedido, produtos, opcoes = {}) {
  const tolerancia = opcoes.toleranciaCentavos ?? 0;
  const erros = [...pedido.erros];
  const itens = [];
  let totalCalculado = 0;

  for (const item of pedido.itens) {
    const codigo = normalizarCodigo(item.codigo);
    const produto = produtos.get(codigo);
    if (!produto) {
      erros.push(`COD ${codigo} não existe na planilha ("${item.linha}")`);
      continue;
    }

    const esperado = Math.round(item.quantidade * produto.preco);
    totalCalculado += esperado;
    if (Math.abs(esperado - item.valorInformado) > tolerancia) {
      erros.push(
        `${formatarQuantidade(item.quantidade)}x ${produto.nome}: informado ${formatarReais(item.valorInformado)}, ` +
          `correto ${formatarReais(esperado)} (${formatarQuantidade(item.quantidade)} × ${formatarReais(produto.preco)})`
      );
    }

    itens.push({
      quantidade: item.quantidade,
      codigo,
      nome: produto.nome,
      precoUnitario: produto.preco,
      valor: esperado,
    });
  }

  if (pedido.totalInformado === null) {
    if (opcoes.exigirTotal) erros.push('Linha "Total: R$..." ausente');
  } else if (Math.abs(pedido.totalInformado - totalCalculado) > tolerancia && erros.length === 0) {
    erros.push(
      `Total informado ${formatarReais(pedido.totalInformado)}, soma correta dos itens ${formatarReais(totalCalculado)}`
    );
  }

  return {
    ok: erros.length === 0,
    cliente: pedido.cliente,
    itens,
    total: totalCalculado,
    erros,
  };
}

module.exports = { conferir };
