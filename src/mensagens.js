// Monta os textos enviados ao cliente e ao grupo.
// IMPORTANTE: as mensagens que o sistema posta no grupo NÃO começam com "Cliente:",
// assim elas nunca são confundidas com um pedido novo.

const { formatarReais, formatarQuantidade } = require('./util');

function aplicarModelo(modelo, vars) {
  return modelo.replace(/\{(\w+)\}/g, (_, chave) => (chave in vars ? vars[chave] : `{${chave}}`));
}

/** Lista de itens SEM o código (o cliente vê só o nome do produto). */
function listaItens(resultado, modeloItem) {
  return resultado.itens
    .map((i) =>
      aplicarModelo(modeloItem, {
        qtd: formatarQuantidade(i.quantidade),
        nome: i.nome,
        unitario: formatarReais(i.precoUnitario),
        valor: formatarReais(i.valor),
      })
    )
    .join('\n');
}

function mensagemCliente(resultado, config) {
  return aplicarModelo(config.mensagemCliente, {
    cliente: resultado.cliente,
    itens: listaItens(resultado, config.modeloItem),
    total: formatarReais(resultado.total),
    pix: config.chavePix ?? '',
  });
}

function mensagemErroGrupo(resultado) {
  return [
    `❌ *Pedido NÃO conferido* — ${resultado.cliente || '(sem nome)'}`,
    '',
    ...resultado.erros.map((e) => `• ${e}`),
    '',
    '_Não foi enviado ao cliente. Corrija e poste o pedido novamente._',
  ].join('\n');
}

/** Resumo para os vendedores no grupo (sem saudação ao cliente). */
function mensagemControleGrupo(resultado, destino) {
  return [
    '✅ *Pedido conferido — valores corretos*',
    `Cliente: ${resultado.cliente}`,
    `Enviado para: ${destino || resultado.cliente}`,
    '',
    ...resultado.itens.map(
      (i) =>
        `${formatarQuantidade(i.quantidade)}x ${i.nome} (${formatarReais(i.precoUnitario)} un.) — ${formatarReais(i.valor)}`
    ),
    '',
    `*Total: ${formatarReais(resultado.total)}*`,
  ].join('\n');
}

function mensagemFalhaEnvioGrupo(resultado, motivo) {
  return [
    `⚠️ *Pedido conferido, mas NÃO enviado* — ${resultado.cliente}`,
    '',
    `• ${motivo}`,
    '',
    '_Os valores estão corretos. Verifique o nome do contato e poste novamente._',
  ].join('\n');
}

/** Pergunta no grupo para quem enviar. opcoes: [{nome, numero}] */
function mensagemEscolhaGrupo(resultado, motivo, opcoes, formatarTelefone) {
  const linhas = [`❓ *Pedido conferido — para quem envio?* (${resultado.cliente})`, '', `• ${motivo}`, ''];
  if (opcoes.length) {
    opcoes.forEach((o, i) => linhas.push(`*${i + 1}* — ${o.nome} (${formatarTelefone(o.numero) || o.id})`));
    linhas.push('');
    linhas.push('_Responda ESTA mensagem com o número da opção, ou com um telefone (DDD + número). Responda 0 para cancelar._');
  } else {
    linhas.push('_Responda ESTA mensagem com o telefone do cliente (DDD + número). Responda 0 para cancelar._');
  }
  return linhas.join('\n');
}

module.exports = {
  mensagemCliente,
  mensagemErroGrupo,
  mensagemControleGrupo,
  mensagemFalhaEnvioGrupo,
  mensagemEscolhaGrupo,
};
