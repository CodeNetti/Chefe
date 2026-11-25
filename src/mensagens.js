// Monta os textos enviados ao cliente e ao grupo.
// IMPORTANTE: as mensagens que o sistema posta no grupo NÃO começam com "Cliente:",
// assim elas nunca são confundidas com um pedido novo.

const { formatarReais, formatarQtdUnidade } = require('./util');

function aplicarModelo(modelo, vars) {
  return modelo.replace(/\{(\w+)\}/g, (_, chave) => (chave in vars ? vars[chave] : `{${chave}}`));
}

/** Lista de itens SEM o código (o cliente vê só o nome do produto). */
function listaItens(resultado, modeloItem) {
  // {qtd} já traz a unidade ("2x", "5g"); modelos antigos usavam "{qtd}x"
  const modelo = String(modeloItem).replace(/\{qtd\}x/g, '{qtd}');
  const linhas = resultado.itens.map((i) =>
    aplicarModelo(modelo, {
      qtd: formatarQtdUnidade(i.quantidade, i.unidade),
      nome: i.nome,
      unitario: formatarReais(i.precoUnitario),
      valor: formatarReais(i.valor),
    })
  );
  if (resultado.frete) linhas.push(`Frete — ${formatarReais(resultado.frete)}`);
  return linhas.join('\n');
}

function mensagemCliente(resultado, config) {
  return aplicarModelo(config.mensagemCliente, {
    cliente: resultado.cliente,
    itens: listaItens(resultado, config.modeloItem),
    total: formatarReais(resultado.total),
    frete: resultado.frete ? formatarReais(resultado.frete) : '',
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
    ...(resultado.entrega ? [`Entrega: ${resultado.entrega}`] : []),
    '',
    ...resultado.itens.map(
      (i) =>
        `${formatarQtdUnidade(i.quantidade, i.unidade)} ${i.nome} (${formatarReais(i.precoUnitario)} un.) — ${formatarReais(i.valor)}`
    ),
    ...(resultado.frete ? [`Frete — ${formatarReais(resultado.frete)}`] : []),
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

// ---------- grupo Tratamento de Texto ----------

function resumoRascunho(r) {
  return r.itens
    .filter((i) => !i.removido)
    .map((i) => `• ${i.quantidade === null ? '?' : formatarQtdUnidade(i.quantidade, i.unidade)} ${i.grupo?.nome || i.termo}`)
    .join('\n');
}

/** Pergunta do Tratamento de Texto. pend vem de proximaPendencia(). */
function mensagemPerguntaTratamento(r, pend) {
  if (pend.tipo === 'produto') {
    const it = r.itens[pend.i];
    const linhas = [`❓ *Não reconheci o produto* "${it.termo}"`, `Linha: ${it.linha}`, ''];
    if (pend.opcoes.length) {
      pend.opcoes.forEach((g, n) => linhas.push(`*${n + 1}* — ${g.nome}`));
      linhas.push('', '_Responda ESTA mensagem com o número da opção, o COD ou o nome do produto. Responda 0 para tirar este item._');
    } else {
      linhas.push('_Responda ESTA mensagem com o COD ou o nome do produto como está na planilha. Responda 0 para tirar este item._');
    }
    return linhas.join('\n');
  }
  if (pend.tipo === 'quantidade') {
    const it = r.itens[pend.i];
    return [
      `❓ *Qual a quantidade de ${it.grupo?.nome || it.termo}?*`,
      `Linha: ${it.linha}`,
      '',
      '_Responda ESTA mensagem com a quantidade (ex.: 5 ou 5g). Responda 0 para tirar este item._',
    ].join('\n');
  }
  const linhas = ['❓ *Para qual cliente é este pedido?*', '', resumoRascunho(r), ''];
  if (pend.opcoes.length) {
    pend.opcoes.forEach((o, n) => linhas.push(`*${n + 1}* — ${o}`));
    linhas.push('');
  }
  linhas.push(
    `_Responda ESTA mensagem com o nome do cliente como está salvo na agenda${pend.opcoes.length ? ' ou com o número da opção' : ''}. Responda 0 para cancelar este pedido._`
  );
  return linhas.join('\n');
}

/** Confirmação no Tratamento de Texto do que foi postado no grupo Pedidos. */
function mensagemConfirmacaoTratamento(pedidos, ignoradas = []) {
  const linhas = [`➡️ *${pedidos.length > 1 ? `${pedidos.length} pedidos montados e enviados` : 'Pedido montado e enviado'} ao grupo Pedidos*`];
  pedidos.forEach((p) => linhas.push('', p.texto));
  if (ignoradas.length) linhas.push('', `_Linhas ignoradas: ${ignoradas.map((l) => `"${l}"`).join(', ')}_`);
  return linhas.join('\n');
}

// Toda mensagem que o sistema posta nos grupos começa com uma destas marcas
const MARCAS_SISTEMA = ['➡️', '➡', '❓', '⚠️', '⚠', '🚫', '✅', '❌'];

/**
 * A mensagem é uma resposta/confirmação postada pelo próprio sistema?
 * (Só faz sentido para mensagens desta conta: msg.fromMe.) A confirmação do Tratamento de Texto
 * traz "Cliente:" e os itens; relida após reiniciar, viraria um pedido novo (bug de 25/11/2026).
 */
function ehMensagemDoSistema(texto) {
  const t = String(texto ?? '').trimStart();
  return MARCAS_SISTEMA.some((m) => t.startsWith(m));
}

module.exports = {
  ehMensagemDoSistema,
  mensagemPerguntaTratamento,
  mensagemConfirmacaoTratamento,
  mensagemCliente,
  mensagemErroGrupo,
  mensagemControleGrupo,
  mensagemFalhaEnvioGrupo,
  mensagemEscolhaGrupo,
};
