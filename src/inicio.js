// Tela de abertura: desenho "CHEFE" + login do assinante (Firebase) + pergunta da chave Pix.
// Roda UMA vez quando o iniciar.bat é aberto (não roda nas reinicializações automáticas).
// Sai com código 1 (o iniciar.bat para) se o login falhar ou o acesso não estiver liberado.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { criarLicenca } = require('./licenca');
const { perguntarLinha, perguntarSenha } = require('./terminal');

const RAIZ = path.resolve(__dirname, '..');
const ARQ_CONFIG = path.join(RAIZ, 'config.json');

// Letras no estilo "ANSI Shadow" (6 linhas de altura, 8 colunas cada)
const LETRAS = {
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  F: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '██║     ', '╚═╝     '],
};

const cor = (codigo) => (t) => `\x1b[${codigo}m${t}\x1b[0m`;
const amarelo = cor('1;33');
const dourado = cor('33');
const ciano = cor('1;36');
const cinza = cor('90');
const verde = cor('1;32');
const vermelho = cor('1;31');

function desenho(palavra) {
  const linhas = [];
  for (let i = 0; i < 6; i++) linhas.push([...palavra].map((l) => LETRAS[l][i]).join(' '));
  return linhas;
}

function banner() {
  const arte = desenho('CHEFE');
  const largura = arte[0].length + 8;
  const borda = '═'.repeat(largura);
  const centro = (t, tamanho = t.length) => {
    const esq = Math.floor((largura - tamanho) / 2);
    return ' '.repeat(esq) + t + ' '.repeat(largura - tamanho - esq);
  };

  console.log('');
  console.log(dourado(`  ╔${borda}╗`));
  console.log(dourado('  ║') + ' '.repeat(largura) + dourado('║'));
  arte.forEach((l, i) => console.log(dourado('  ║') + (i < 3 ? amarelo : dourado)(centro(l)) + dourado('║')));
  console.log(dourado('  ║') + ' '.repeat(largura) + dourado('║'));
  const sub = 'D O M Í N I O   D O   C H E F E';
  console.log(dourado('  ║') + ciano(centro(sub)) + dourado('║'));
  const sub2 = 'Conferência automática de pedidos';
  console.log(dourado('  ║') + cinza(centro(sub2)) + dourado('║'));
  console.log(dourado('  ║') + ' '.repeat(largura) + dourado('║'));
  console.log(dourado(`  ╚${borda}╝`));
  console.log('');
}

function perguntar(rl, texto) {
  return new Promise((resolve) => rl.question(texto, (r) => resolve(r.trim())));
}

/** Login do assinante. true = liberado. Até 3 tentativas de senha. */
async function fazerLogin() {
  const licenca = criarLicenca({ raiz: RAIZ });
  if (!licenca.configurado()) {
    console.log(vermelho('  ❌ Firebase não configurado em src/firebase-config.js (veja FIREBASE.md).'));
    return false;
  }
  console.log(`  ${ciano('🔐 Login do assinante')}`);
  const salvo = licenca.lerSessao()?.usuario || '';
  let usuario = '';
  if (salvo) {
    usuario = await perguntarLinha(`  ${ciano('➜')} Usuário ${cinza(`(ENTER para ${salvo})`)}: `);
    if (!usuario) usuario = salvo;
  }
  while (!usuario) usuario = await perguntarLinha(`  ${ciano('➜')} Usuário: `);

  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const senha = await perguntarSenha(`  ${ciano('➜')} Senha: `);
    process.stdout.write(cinza('  Verificando...'));
    const r = await licenca.login(usuario, senha);
    process.stdout.write('\r' + ' '.repeat(20) + '\r');
    if (r.ok) {
      console.log(verde(`  ✔ Acesso liberado para ${r.usuario}.`));
      console.log('');
      return true;
    }
    console.log(vermelho(`  ❌ ${r.motivo}`));
    // Só vale tentar de novo quando o problema pode ser a senha
    if (!/senha incorretos|Digite a senha/.test(r.motivo)) return false;
  }
  return false;
}

async function main() {
  banner();

  let config;
  try {
    // 1ª abertura de uma cópia nova: cria o config.json a partir do modelo
    if (!fs.existsSync(ARQ_CONFIG)) fs.copyFileSync(path.join(RAIZ, 'config.exemplo.json'), ARQ_CONFIG);
    config = JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8'));
  } catch (e) {
    console.log(vermelho(`  ❌ Não foi possível ler o config.json: ${e.message}`));
    process.exit(1);
  }

  // Configs da versão 1 não têm o grupo de tratamento: acrescenta o padrão
  if (!('grupoTratamento' in config)) {
    config.grupoTratamento = 'Tratamento de Texto';
    fs.writeFileSync(ARQ_CONFIG, JSON.stringify(config, null, 2) + '\n');
  }

  console.log(`  ${cinza('Grupo de pedidos:')}    ${amarelo(config.grupo)}`);
  console.log(`  ${cinza('Grupo de tratamento:')} ${config.grupoTratamento ? amarelo(config.grupoTratamento) : cinza('(desligado)')}`);
  console.log(`  ${cinza('Planilha:')}            ${amarelo(config.planilhaProdutos)}`);
  console.log('');

  // Sem teclado (ex.: rodando em segundo plano): segue com o que já está salvo
  // (o index.js confere a licença salva e para se não estiver liberada)
  if (!process.stdin.isTTY) return;

  if (!(await fazerLogin())) {
    console.log('');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const atual = String(config.chavePix ?? '').trim();
  let chave = '';

  if (atual) {
    console.log(`  ${cinza('Chave Pix atual:')} ${verde(atual)}`);
    chave = await perguntar(rl, `  ${ciano('➜')} Digite uma nova chave Pix ou aperte ${amarelo('ENTER')} para manter: `);
    if (!chave) chave = atual;
  } else {
    while (!chave) {
      chave = await perguntar(rl, `  ${ciano('➜')} Digite a chave Pix para recebimento: `);
      if (!chave) console.log(vermelho('  A chave Pix é obrigatória.'));
    }
  }
  rl.close();

  if (chave !== atual) {
    config.chavePix = chave;
    fs.writeFileSync(ARQ_CONFIG, JSON.stringify(config, null, 2) + '\n');
    console.log(verde('  ✔ Chave Pix salva.'));
  } else {
    console.log(verde('  ✔ Chave Pix mantida.'));
  }
  console.log('');
}

main();
