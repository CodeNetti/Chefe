// Gerencia os assinantes no Firebase (SÓ para você; não vai no pacote do cliente).
// Usa o login do Google Cloud SDK deste computador (gcloud auth login) como administrador.
//
//   npm run assinante -- listar
//   npm run assinante -- novo joao "Mercado do João"   (pede a senha; cria o login e libera: acesso = 1)
//   npm run assinante -- bloquear joao                  (acesso = 2)
//   npm run assinante -- liberar joao                   (acesso = 1)
//   npm run assinante -- senha joao                     (pede a senha nova)
//
// A senha é pedida na hora (aparece *****) e não fica salva em lugar nenhum.
// Para automação, a senha pode vir da variável de ambiente CHEFE_SENHA.

const path = require('path');
const { execSync } = require('child_process');
const config = require('../src/firebase-config');
const { normalizarUsuario } = require('../src/licenca');
const { perguntarSenha } = require('../src/terminal');

const PROJETO = config.projectId;
const DOMINIO = config.dominioUsuarios || 'chefe.local';
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJETO}/databases/(default)/documents/licencas`;
const AUTH = `https://identitytoolkit.googleapis.com/v1/projects/${PROJETO}`;

function gcloud() {
  const padrao = path.join(process.env.LOCALAPPDATA || '', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd');
  return process.env.GCLOUD || (require('fs').existsSync(padrao) ? padrao : 'gcloud');
}

let token = null;
function tokenAdmin() {
  if (token) return token;
  try {
    token = execSync(`"${gcloud()}" auth print-access-token`, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch (e) {
    throw new Error('Não consegui o acesso de administrador. Rode "gcloud auth login" com a conta dona do projeto.');
  }
  return token;
}

async function api(metodo, url, corpo) {
  const resp = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${tokenAdmin()}`, 'x-goog-user-project': PROJETO, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = new Error(dados?.error?.message || `HTTP ${resp.status}`);
    e.status = resp.status;
    throw e;
  }
  return dados;
}

const emailDe = (usuario) => `${usuario}@${DOMINIO}`;

async function acharConta(usuario) {
  const r = await api('POST', `${AUTH}/accounts:lookup`, { email: [emailDe(usuario)] });
  return r.users?.[0] || null;
}

async function gravarLicenca(usuario, campos) {
  const fields = {};
  const mascara = [];
  for (const [k, v] of Object.entries(campos)) {
    if (v === undefined) continue;
    fields[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
    mascara.push(`updateMask.fieldPaths=${k}`);
  }
  await api('PATCH', `${FIRESTORE}/${encodeURIComponent(usuario)}?${mascara.join('&')}`, { fields });
}

async function lerSenha(rotulo) {
  if (process.env.CHEFE_SENHA) return process.env.CHEFE_SENHA;
  if (!process.stdin.isTTY) throw new Error('Sem terminal para digitar a senha (use a variável CHEFE_SENHA).');
  const s1 = await perguntarSenha(`${rotulo}: `);
  const s2 = await perguntarSenha('Repita a senha: ');
  if (s1 !== s2) throw new Error('As senhas não conferem.');
  return s1;
}

function validarSenha(senha) {
  if (String(senha).length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres.');
}

function usuarioDoArgumento(arg) {
  const u = normalizarUsuario(arg);
  if (!u) throw new Error(`Usuário inválido: "${arg ?? ''}". Use letras, números, ponto, traço ou sublinhado (sem espaço).`);
  return u;
}

const COMANDOS = {
  async listar() {
    const r = await api('GET', `${FIRESTORE}?pageSize=300`);
    const docs = r.documents || [];
    if (!docs.length) return console.log('Nenhum assinante cadastrado.');
    console.log('USUÁRIO               ACESSO        NOME');
    for (const d of docs) {
      const usuario = decodeURIComponent(d.name.split('/').pop());
      const f = d.fields || {};
      const acesso = Number(f.acesso?.integerValue ?? f.acesso?.doubleValue ?? f.acesso?.stringValue);
      const status = acesso === 1 ? '1 liberado' : acesso === 2 ? '2 bloqueado' : `${acesso} ?`;
      console.log(`${usuario.padEnd(22)}${status.padEnd(14)}${f.nome?.stringValue || ''}`);
    }
  },

  async novo(arg, nome) {
    const usuario = usuarioDoArgumento(arg);
    if (await acharConta(usuario)) throw new Error(`O usuário "${usuario}" já existe. Use "senha" ou "liberar".`);
    const senha = await lerSenha(`Senha para ${usuario}`);
    validarSenha(senha);
    await api('POST', `${AUTH}/accounts`, { email: emailDe(usuario), password: senha, emailVerified: true });
    await gravarLicenca(usuario, { acesso: 1, nome });
    console.log(`✔ Assinante "${usuario}" criado e LIBERADO (acesso = 1).`);
    console.log(`  Passe ao assinante: usuário "${usuario}" e a senha que você digitou.`);
  },

  async bloquear(arg) {
    const usuario = usuarioDoArgumento(arg);
    await gravarLicenca(usuario, { acesso: 2 });
    console.log(`✔ "${usuario}" BLOQUEADO (acesso = 2). O sistema dele para em até 30 minutos.`);
  },

  async liberar(arg) {
    const usuario = usuarioDoArgumento(arg);
    if (!(await acharConta(usuario))) throw new Error(`O usuário "${usuario}" não existe. Crie com "novo".`);
    await gravarLicenca(usuario, { acesso: 1 });
    console.log(`✔ "${usuario}" LIBERADO (acesso = 1).`);
  },

  async senha(arg) {
    const usuario = usuarioDoArgumento(arg);
    const conta = await acharConta(usuario);
    if (!conta) throw new Error(`O usuário "${usuario}" não existe.`);
    const senha = await lerSenha(`Senha nova para ${usuario}`);
    validarSenha(senha);
    await api('POST', `${AUTH}/accounts:update`, { localId: conta.localId, password: senha });
    console.log(`✔ Senha de "${usuario}" trocada. O assinante precisa entrar de novo com a senha nova.`);
  },
};

async function main() {
  const [comando, ...args] = process.argv.slice(2);
  if (!PROJETO) throw new Error('Firebase não configurado em src/firebase-config.js.');
  const fn = COMANDOS[comando];
  if (!fn) {
    console.log('Uso: npm run assinante -- <listar | novo USUARIO "Nome" | bloquear USUARIO | liberar USUARIO | senha USUARIO>');
    process.exitCode = 1;
    return;
  }
  await fn(...args);
}

main().catch((e) => {
  console.error(`❌ ${e.message}`);
  process.exitCode = 1;
});
