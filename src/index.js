// Domínio do Chefe — conferência automática de pedidos no WhatsApp.
//
// Fluxo:
//  1. Fica escutando UM grupo do WhatsApp (config.grupo).
//  2. Mensagem que começa com "Cliente:" é tratada como pedido.
//  3. Confere cada item pelo COD na planilha: quantidade × preço = valor da linha.
//  4. Tudo certo  -> envia o pedido (sem os códigos) ao contato do cliente,
//                    reage ✅ na mensagem original e posta a cópia de controle no grupo.
//     Algo errado -> reage ❌ e responde no grupo com os erros. NÃO envia ao cliente.
//     Conferido mas contato não encontrado -> reage ❓ e pergunta no grupo para quem enviar.
//  5. Grupo Tratamento de Texto (config.grupoTratamento, opcional): recebe pedidos bagunçados,
//     monta no formato certo (src/tratamento.js), pergunta o que não entender e posta no grupo
//     de pedidos, onde o passo 3 confere normalmente.

const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Client, NoAuth } = require('whatsapp-web.js');

const { parsePedido } = require('./parser');
const { Catalogo } = require('./catalogo');
const { conferir } = require('./conferencia');
const { resolverDestino, contatoPorNumero, formatarTelefone } = require('./contatos');
const { Registro } = require('./registro');
const M = require('./mensagens');
const { log, normalizar, esperarAleatorio } = require('./util');
const { comTimeout, listarGrupos, listarContatos } = require('./whatsapp');
const T = require('./tratamento');

const RAIZ = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'config.json'), 'utf8'));
const catalogo = new Catalogo(path.resolve(RAIZ, config.planilhaProdutos));
const registro = new Registro(RAIZ);

let grupoId = null; // grupo de pedidos
let grupoTratamentoId = null; // grupo Tratamento de Texto (opcional)
const enviadosPeloSistema = new Set();

// Perguntas do Tratamento de Texto aguardando resposta.
// chave = ID da mensagem de pergunta -> { original, rascunhos, r, pend } (só em memória)
const pendentesTratamento = new Map();

// Perguntas "para quem envio?" aguardando resposta no grupo.
// chave = ID da mensagem de pergunta -> { original, resultado, opcoes }
// (fica só em memória: se o sistema reiniciar, poste o pedido de novo)
const escolhasPendentes = new Map();
// Resposta de escolha: só número da opção ou telefone
const RE_ESCOLHA = /^\s*\+?[\d\s().-]{1,20}\s*$/;

// Processa uma mensagem por vez, na ordem de chegada
let fila = Promise.resolve();
function enfileirar(tarefa) {
  fila = fila.then(tarefa).catch((e) => log('💥 Erro inesperado:', e));
}

const puppeteer = {
  headless: !config.mostrarNavegador,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
};
const navegador = acharNavegador();
if (navegador) puppeteer.executablePath = navegador;

/**
 * Ordem: chromePath do config -> Chrome que vem no pacote (pasta chrome/) ->
 * Chrome baixado pelo npm install -> Chrome ou Edge instalados no Windows.
 */
function acharNavegador() {
  const candidatos = [config.chromePath, path.join(RAIZ, 'chrome', 'chrome.exe')];
  try {
    candidatos.push(require('puppeteer').executablePath());
  } catch (e) {
    /* puppeteer sem Chrome baixado */
  }
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  candidatos.push(
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  );
  const achado = candidatos.find((c) => c && fs.existsSync(c));
  if (!achado) log('⚠️  Nenhum navegador encontrado. Instale o Google Chrome ou ajuste "chromePath" no config.json.');
  else if (config.debug) log('🌐 Navegador:', achado);
  return achado;
}

// A sessão do WhatsApp fica salva no perfil do Chrome em .sessao/session (mesma pasta que o
// LocalAuth usava). Não usamos o LocalAuth porque, desde a mudança do WhatsApp Web de
// 23/11/2026 (página /login/), ele impede o QR Code de aparecer na primeira conexão.
puppeteer.userDataDir = path.join(RAIZ, '.sessao', 'session');

const client = new Client({
  authStrategy: new NoAuth(),
  puppeteer,
  // Na 1ª abertura (perfil novo) o WhatsApp Web demora para carregar; o padrão de 30s é pouco
  authTimeoutMs: 120000,
});

client.on('qr', (qr) => {
  log('📱 Escaneie o QR Code abaixo com o WhatsApp (Aparelhos conectados > Conectar aparelho):');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => log('🔐 Autenticado'));
client.on('auth_failure', (m) => log('❌ Falha na autenticação:', m));

client.on('disconnected', (motivo) => {
  log('🔌 Desconectado:', motivo, '— encerrando para reiniciar.');
  process.exit(1); // o iniciar.bat reinicia automaticamente
});

client.on('ready', () =>
  enfileirar(async () => {
    log('✅ WhatsApp conectado');
    await catalogo.obter();

    // A lista de conversas pode demorar alguns segundos para carregar após conectar
    let grupos = [];
    const acharGrupo = (nome) => grupos.filter((g) => normalizar(g.nome) === normalizar(nome));
    for (let tentativa = 1; tentativa <= 6; tentativa++) {
      grupos = await listarGrupos(client);
      const achados = acharGrupo(config.grupo);
      if (achados.length === 1) {
        grupoId = achados[0].id;
        break;
      }
      if (achados.length > 1) {
        log(`❌ Existem ${achados.length} grupos chamados "${config.grupo}". Renomeie um deles.`);
        process.exit(2);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }

    const lista = grupos.map((g) => `  - ${g.nome}`).join('\n') || '  (nenhum)';
    if (!grupoId) {
      log(`❌ Grupo "${config.grupo}" não encontrado. Ajuste "grupo" no config.json. Grupos disponíveis:\n${lista}`);
      process.exit(2);
    }
    log(`👀 Monitorando o grupo de pedidos "${config.grupo}" (${grupoId})`);

    // Grupo Tratamento de Texto é opcional: sem ele, o sistema segue só com o de pedidos
    if (config.grupoTratamento) {
      const achados = acharGrupo(config.grupoTratamento);
      if (achados.length === 1) {
        grupoTratamentoId = achados[0].id;
        log(`👀 Monitorando o grupo de tratamento "${config.grupoTratamento}" (${grupoTratamentoId})`);
      } else if (achados.length > 1) {
        log(`⚠️  Existem ${achados.length} grupos chamados "${config.grupoTratamento}". Renomeie um deles. Tratamento de texto DESLIGADO.`);
      } else {
        log(`⚠️  Grupo "${config.grupoTratamento}" não encontrado. Tratamento de texto DESLIGADO. Grupos disponíveis:\n${lista}`);
      }
    }

    for (const [id, nome] of [[grupoId, config.grupo], [grupoTratamentoId, config.grupoTratamento]]) {
      if (!id) continue;
      try {
        await processarHistorico(id, nome);
      } catch (e) {
        log(`⚠️  Não foi possível verificar mensagens antigas de "${nome}":`, e.message);
      }
    }
    log('🟢 Pronto. Aguardando pedidos...');
  })
);

// message_create dispara para mensagens de outros E para as enviadas por esta conta
client.on('message_create', (msg) => enfileirar(() => tratarMensagem(msg)));

/** Ao iniciar, trata mensagens que chegaram enquanto o sistema estava desligado. */
async function processarHistorico(id, nome) {
  const limite = config.historicoAoIniciar ?? 50;
  if (limite <= 0) return;
  const grupo = await comTimeout(client.getChatById(id), 60000, 'abrir o grupo');
  const mensagens = await comTimeout(grupo.fetchMessages({ limit: limite }), 60000, 'buscar mensagens antigas');

  if (registro.grupoNovo(id)) {
    // Primeira vez deste grupo: não mexe em mensagens antigas, só marca como vistas
    mensagens.forEach((m) => registro.marcarProcessado(m.id._serialized));
    registro.marcarGrupo(id);
    log(`ℹ️  Primeira vez no grupo "${nome}": ${mensagens.length} mensagens antigas ignoradas`);
    return;
  }

  const pendentes = mensagens.filter((m) => !registro.jaProcessado(m.id._serialized));
  if (pendentes.length) log(`🔎 "${nome}": verificando ${pendentes.length} mensagens recebidas enquanto estava desligado`);
  for (const m of pendentes) await tratarMensagem(m);
}

async function tratarMensagem(msg) {
  if (!grupoId) return;
  const chatId = msg.fromMe ? msg.to : msg.from;
  if (grupoTratamentoId && chatId === grupoTratamentoId) return tratarTexto(msg);
  if (chatId !== grupoId) return;

  const id = msg.id._serialized;
  if (config.debug) {
    log(`📨 Mensagem no grupo [${msg.type}] ${msg.fromMe ? '(minha) ' : ''}"${String(msg.body).split('\n')[0].slice(0, 60)}"`);
  }
  if (msg.type !== 'chat') return;
  if (enviadosPeloSistema.has(id) || registro.jaProcessado(id)) return;

  // Resposta a uma pergunta "para quem envio?" (número da opção ou telefone)
  if (RE_ESCOLHA.test(msg.body) && escolhasPendentes.size) {
    await tratarEscolha(msg);
    return;
  }

  const pedido = parsePedido(msg.body);
  if (!pedido) return; // conversa comum, não é pedido

  registro.marcarProcessado(id); // marca antes de agir: nunca envia o mesmo pedido 2x
  log(`📝 Pedido recebido: ${pedido.cliente} (${pedido.itens.length} itens)`);

  let produtos;
  try {
    produtos = await catalogo.obter();
  } catch (e) {
    log('❌ Erro ao ler a planilha:', e.message);
    await reagir(msg, '⚠️');
    await responderNoGrupo(msg, `⚠️ *Erro ao ler a planilha de produtos*\n\n• ${e.message}\n\n_Corrija a planilha e poste o pedido novamente._`);
    registro.anotar('FALHA', { cliente: pedido.cliente, itens: [], total: 0, erros: [] }, `Planilha: ${e.message}`);
    return;
  }

  const resultado = conferir(pedido, produtos, config);

  if (!resultado.ok) {
    log(`❌ Pedido de ${resultado.cliente} com divergências:\n   ${resultado.erros.join('\n   ')}`);
    await reagir(msg, '❌');
    await responderNoGrupo(msg, M.mensagemErroGrupo(resultado));
    registro.anotar('ERRO', resultado);
    return;
  }

  let busca;
  try {
    busca = await resolverDestino(client, resultado.cliente, pedido.destino, config.prefixoPreferido ?? '55');
  } catch (e) {
    busca = { erro: `Falha ao consultar a agenda: ${e.message}`, opcoes: [] };
  }

  if (busca.contato) {
    await enviarPedido(msg, resultado, busca.contato);
    return;
  }

  // Não deu para decidir sozinho: pergunta no grupo
  log(`❓ ${busca.erro} — aguardando escolha no grupo`);
  await reagir(msg, '❓');
  const pergunta = await responderNoGrupo(
    msg,
    M.mensagemEscolhaGrupo(resultado, busca.erro, busca.opcoes ?? [], formatarTelefone)
  );
  if (pergunta?.id) {
    escolhasPendentes.set(pergunta.id.id, { original: msg, resultado, opcoes: busca.opcoes ?? [] });
  }
}

/** Envia o pedido conferido ao contato, reage ✅ e posta a cópia de controle. */
async function enviarPedido(msgOriginal, resultado, contato) {
  const texto = M.mensagemCliente(resultado, config);
  try {
    await esperarAleatorio();
    const enviada = await comTimeout(client.sendMessage(contato.id, texto), 60000, 'enviar ao cliente');
    if (enviada?.id) enviadosPeloSistema.add(enviada.id._serialized);
  } catch (e) {
    log('❌ Falha ao enviar ao cliente:', e.message);
    await reagir(msgOriginal, '⚠️');
    await responderNoGrupo(msgOriginal, M.mensagemFalhaEnvioGrupo(resultado, `Erro no envio: ${e.message}`));
    registro.anotar('NAO_ENVIADO', resultado, e.message);
    return false;
  }

  const destino = `${contato.nome} (${formatarTelefone(contato.numero) || contato.id})`;
  await reagir(msgOriginal, '✅');
  await responderNoGrupo(msgOriginal, M.mensagemControleGrupo(resultado, destino));
  registro.anotar('OK', resultado, `Enviado para ${destino}`);
  log(`✅ Pedido de ${resultado.cliente} conferido e enviado para ${destino}`);
  return true;
}

/** ID da mensagem citada (respondida), ou null. */
async function idCitado(msg) {
  let citada = msg._data?.quotedStanzaID || null;
  if (!citada && msg.hasQuotedMsg) {
    try {
      citada = (await comTimeout(msg.getQuotedMessage(), 20000, 'ler mensagem citada'))?.id?.id ?? null;
    } catch (e) {
      log('⚠️  Não foi possível ler a mensagem citada:', e.message);
    }
  }
  return citada;
}

/** Trata a resposta do grupo a uma pergunta "para quem envio?". */
async function tratarEscolha(msg) {
  // Qual pergunta está sendo respondida? Pela mensagem citada; se não citou e só há uma, é ela.
  const citada = await idCitado(msg);
  let chave = citada && escolhasPendentes.has(citada) ? citada : null;
  if (!chave && !citada && escolhasPendentes.size === 1) chave = [...escolhasPendentes.keys()][0];
  if (!chave) {
    if (!citada && escolhasPendentes.size > 1) {
      await responderNoGrupo(msg, '❓ Há mais de um pedido aguardando escolha. *Responda citando* a pergunta do pedido certo.');
    }
    return; // número solto que não é resposta a uma pergunta
  }

  registro.marcarProcessado(msg.id._serialized);
  const pendente = escolhasPendentes.get(chave);
  const resposta = msg.body.trim();
  const digitos = resposta.replace(/\D/g, '');

  if (digitos === '0') {
    escolhasPendentes.delete(chave);
    await reagir(pendente.original, '🚫');
    await responderNoGrupo(msg, `🚫 Envio cancelado — ${pendente.resultado.cliente}`);
    registro.anotar('NAO_ENVIADO', pendente.resultado, 'Cancelado no grupo');
    return;
  }

  let contato = null;
  if (digitos.length <= 2) {
    contato = pendente.opcoes[Number(digitos) - 1] ?? null;
    if (!contato) {
      await responderNoGrupo(msg, `❓ Opção ${digitos} não existe. Responda com 1 a ${pendente.opcoes.length}, um telefone, ou 0 para cancelar.`);
      return;
    }
  } else {
    let r;
    try {
      r = await contatoPorNumero(client, resposta);
    } catch (e) {
      r = { erro: `Falha ao validar o número: ${e.message}` };
    }
    if (r.erro) {
      await responderNoGrupo(msg, `❓ ${r.erro}. Tente outro número ou responda 0 para cancelar.`);
      return;
    }
    contato = r.contato;
  }

  escolhasPendentes.delete(chave);
  await enviarPedido(pendente.original, pendente.resultado, contato);
}

// ---------- grupo Tratamento de Texto ----------

/** Mensagem no grupo Tratamento de Texto: resposta a uma pergunta ou pedido novo para montar. */
async function tratarTexto(msg) {
  const id = msg.id._serialized;
  if (msg.type !== 'chat') return;
  if (enviadosPeloSistema.has(id) || registro.jaProcessado(id)) return;
  if (config.debug) log(`📨 Tratamento [${msg.fromMe ? 'minha' : 'colega'}] "${String(msg.body).split('\n')[0].slice(0, 60)}"`);

  // Resposta a uma pergunta? Pela citação; sem citação, só se houver uma pergunta aberta
  // e a mensagem for curta e não parecer um pedido novo.
  if (pendentesTratamento.size) {
    const citada = await idCitado(msg);
    let chave = citada && pendentesTratamento.has(citada) ? citada : null;
    const curta = !String(msg.body).trim().includes('\n') && !T.pareceItem(msg.body);
    if (!chave && !citada && pendentesTratamento.size === 1 && curta) chave = [...pendentesTratamento.keys()][0];
    if (chave) {
      registro.marcarProcessado(id);
      await responderTratamento(msg, chave);
      return;
    }
  }

  let produtos;
  try {
    produtos = await catalogo.obter();
  } catch (e) {
    registro.marcarProcessado(id);
    await reagir(msg, '⚠️');
    await responderNoGrupo(msg, `⚠️ *Erro ao ler a planilha de produtos*\n\n• ${e.message}`, grupoTratamentoId);
    return;
  }

  let contatos = null;
  try {
    contatos = (await listarContatos(client)).map((c) => c.nome).filter(Boolean);
  } catch (e) {
    log('⚠️  Não foi possível ler a agenda:', e.message);
  }

  const rascunhos = T.interpretarTudo(msg.body, produtos, { aprendidos: registro.apelidos, contatos });
  if (!rascunhos.length) return; // conversa comum, sem itens
  registro.marcarProcessado(id);
  log(`🧹 Tratamento: ${rascunhos.length} pedido(s) para montar`);
  await avancarTratamento({ original: msg, rascunhos });
}

/** Faz a próxima pergunta pendente ou, se não houver, monta e posta os pedidos no grupo Pedidos. */
async function avancarTratamento(estado) {
  for (const r of estado.rascunhos) {
    const pend = T.proximaPendencia(r);
    if (!pend) continue;
    const pergunta = await responderNoGrupo(estado.original, M.mensagemPerguntaTratamento(r, pend), grupoTratamentoId);
    if (pergunta?.id) pendentesTratamento.set(pergunta.id.id, { ...estado, r, pend });
    await reagir(estado.original, '❓');
    log(`❓ Tratamento: pergunta de ${pend.tipo} no grupo`);
    return;
  }

  const produtos = await catalogo.obter();
  const pedidos = estado.rascunhos.flatMap((r) => T.montarPedidos(r, produtos));
  if (!pedidos.length) {
    await reagir(estado.original, '🚫');
    await responderNoGrupo(estado.original, '🚫 Nada para enviar: todos os itens foram retirados.', grupoTratamentoId);
    return;
  }

  const postados = [];
  for (const p of pedidos) {
    try {
      await esperarAleatorio();
      // NÃO entra em enviadosPeloSistema: a conferência do grupo Pedidos precisa ler esta mensagem
      const enviada = await comTimeout(client.sendMessage(grupoId, p.texto), 60000, 'postar no grupo Pedidos');
      postados.push(p);
      if (enviada) enfileirar(() => tratarMensagem(enviada));
    } catch (e) {
      log('❌ Falha ao postar no grupo Pedidos:', e.message);
      await responderNoGrupo(estado.original, `⚠️ Não consegui postar o pedido de ${p.cliente} no grupo Pedidos: ${e.message}`, grupoTratamentoId);
    }
  }
  if (!postados.length) return;

  const ignoradas = estado.rascunhos.flatMap((r) => r.ignoradas);
  await reagir(estado.original, '✅');
  await responderNoGrupo(estado.original, M.mensagemConfirmacaoTratamento(postados, ignoradas), grupoTratamentoId);
  log(`➡️  Tratamento: ${postados.length} pedido(s) postado(s) no grupo Pedidos (${postados.map((p) => p.cliente).join(', ')})`);
}

/** Aplica a resposta do colega e continua (próxima pergunta ou envio). */
async function responderTratamento(msg, chave) {
  const estado = pendentesTratamento.get(chave);
  const produtos = await catalogo.obter();
  const res = T.aplicarResposta(estado.r, estado.pend, msg.body, produtos, registro.apelidos);
  if (!res.ok) {
    await responderNoGrupo(msg, `❓ ${res.erro}`, grupoTratamentoId);
    return; // pergunta continua aberta
  }
  pendentesTratamento.delete(chave);
  if (res.apelido) {
    registro.salvarApelido(res.apelido.termo, res.apelido.nome);
    log(`🧠 Aprendido: "${res.apelido.termo}" = ${res.apelido.nome}`);
  }
  await avancarTratamento({ original: estado.original, rascunhos: estado.rascunhos });
}

async function reagir(msg, emoji) {
  try {
    await esperarAleatorio(400, 1000);
    await comTimeout(msg.react(emoji), 30000, 'reagir');
  } catch (e) {
    log(`⚠️  Não foi possível reagir com ${emoji}:`, e.message);
  }
}

async function responderNoGrupo(msg, texto, chatId = grupoId) {
  try {
    await esperarAleatorio();
    const enviada = await comTimeout(msg.reply(texto, chatId), 60000, 'responder no grupo');
    if (enviada?.id) enviadosPeloSistema.add(enviada.id._serialized);
    return enviada;
  } catch (e) {
    log('⚠️  Não foi possível responder no grupo:', e.message);
    return null;
  }
}

process.on('SIGINT', async () => {
  log('👋 Encerrando...');
  try {
    await client.destroy();
  } finally {
    process.exit(0);
  }
});

log('🚀 Iniciando Domínio do Chefe...');
client.initialize();
