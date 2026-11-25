// Licença de uso (assinatura) pelo Firebase.
//
// - Login: USUÁRIO e senha. Por baixo é o Firebase Authentication (e-mail e senha), com o e-mail
//   técnico usuario@<dominioUsuarios> (ex.: joao -> joao@chefe.local), pela API REST (sem SDK).
// - Permissão: Firestore, documento licencas/{usuario} com o campo "acesso":
//       1 = liberado    2 = bloqueado    sem documento / outro valor = bloqueado
//   No Firebase fica SÓ isso: nenhum dado de pedido, cliente ou WhatsApp.
// - No computador fica estado/licenca.json: usuário, token de renovação do Firebase (NÃO a senha)
//   e a hora da última verificação liberada. Assim o iniciar.bat reinicia sem pedir a senha.
// - Sem internet: continua funcionando por até 24h desde a última verificação liberada.

const fs = require('fs');
const path = require('path');

const TOLERANCIA_OFFLINE_MS = 24 * 60 * 60 * 1000;
const INTERVALO_VERIFICACAO_MS = 30 * 60 * 1000;
const CODIGO_SAIDA_BLOQUEADO = 10; // o iniciar.bat para (não reinicia) com este código
const ACESSO_LIBERADO = 1;
const ACESSO_BLOQUEADO = 2;

/** definitivo = false: problema de internet/servidor (vale a tolerância offline). */
class ErroLicenca extends Error {
  constructor(mensagem, { definitivo = true, relogar = false } = {}) {
    super(mensagem);
    this.definitivo = definitivo;
    this.relogar = relogar;
  }
}

const ERROS_LOGIN = {
  INVALID_LOGIN_CREDENTIALS: 'Usuário ou senha incorretos.',
  EMAIL_NOT_FOUND: 'Usuário ou senha incorretos.',
  INVALID_PASSWORD: 'Usuário ou senha incorretos.',
  INVALID_EMAIL: 'Usuário inválido.',
  MISSING_PASSWORD: 'Digite a senha.',
  USER_DISABLED: 'Este usuário foi desativado. Fale com o suporte.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Muitas tentativas erradas. Aguarde alguns minutos e tente de novo.',
  OPERATION_NOT_ALLOWED: 'Login por e-mail e senha não está ativado no Firebase (veja FIREBASE.md, passo 2).',
  CONFIGURATION_NOT_FOUND: 'Authentication não está ativado no Firebase (veja FIREBASE.md, passo 2).',
};
const ERROS_RENOVACAO = {
  TOKEN_EXPIRED: 'Sua sessão expirou (a senha foi trocada?). Faça login de novo.',
  INVALID_REFRESH_TOKEN: 'Sessão inválida. Faça login de novo.',
  USER_DISABLED: 'Este usuário foi desativado. Fale com o suporte.',
  USER_NOT_FOUND: 'Usuário não existe mais. Fale com o suporte.',
};

function codigoErroFirebase(corpo) {
  const msg = String(corpo?.error?.message ?? '');
  return msg.split(/\s*:\s*/)[0].trim();
}

/** Valor do campo "acesso" do documento do Firestore (aceita número ou texto "1"). */
function lerCampoAcesso(doc) {
  const f = doc?.fields?.acesso;
  if (!f) return null;
  const bruto = f.integerValue ?? f.doubleValue ?? f.stringValue;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/** " João.Silva " -> "joao.silva" | null se inválido (letras, números, ponto, traço, sublinhado; 2 a 40). */
function normalizarUsuario(usuario) {
  const u = String(usuario ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{1,39}$/.test(u) ? u : null;
}

/**
 * @param ctx.raiz   pasta do sistema (onde fica estado/)
 * @param ctx.config { apiKey, projectId, dominioUsuarios } (padrão: src/firebase-config.js)
 * @param ctx.fetch  para testes
 * @param ctx.agora  para testes
 */
function criarLicenca({ raiz, config = require('./firebase-config'), fetch = globalThis.fetch, agora = Date.now } = {}) {
  const arquivoSessao = path.join(raiz, 'estado', 'licenca.json');
  const dominio = config.dominioUsuarios || 'chefe.local';

  const configurado = () => !!(config.apiKey && config.projectId);

  function lerSessao() {
    try {
      return JSON.parse(fs.readFileSync(arquivoSessao, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  function salvarSessao(dados) {
    fs.mkdirSync(path.dirname(arquivoSessao), { recursive: true });
    fs.writeFileSync(arquivoSessao, JSON.stringify(dados, null, 2) + '\n');
  }

  function esquecerSessao() {
    const s = lerSessao();
    salvarSessao({ usuario: s?.usuario ?? '' }); // mantém só o usuário, para sugerir no próximo login
  }

  async function chamar(url, opcoes) {
    let resp;
    try {
      resp = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(20000) });
    } catch (e) {
      throw new ErroLicenca(`Sem conexão com o servidor de licenças (${e.message}).`, { definitivo: false });
    }
    let corpo = null;
    try {
      corpo = await resp.json();
    } catch (e) {
      /* corpo vazio ou não-JSON */
    }
    if (resp.status >= 500) throw new ErroLicenca(`Servidor de licenças indisponível (HTTP ${resp.status}).`, { definitivo: false });
    return { status: resp.status, corpo };
  }

  /** E-mail técnico e senha -> { uid, idToken, refreshToken } */
  async function entrar(email, senha) {
    const { status, corpo } = await chamar(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: senha, returnSecureToken: true }),
      }
    );
    if (status !== 200) {
      const codigo = codigoErroFirebase(corpo);
      if (/API key not valid/i.test(corpo?.error?.message ?? '')) throw new ErroLicenca('apiKey inválida em src/firebase-config.js.');
      throw new ErroLicenca(ERROS_LOGIN[codigo] || `Falha no login (${codigo || `HTTP ${status}`}).`);
    }
    return { uid: corpo.localId, idToken: corpo.idToken, refreshToken: corpo.refreshToken };
  }

  /** Token de renovação -> { uid, idToken, refreshToken } */
  async function renovar(refreshToken) {
    const { status, corpo } = await chamar(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
    });
    if (status !== 200) {
      const codigo = codigoErroFirebase(corpo);
      throw new ErroLicenca(ERROS_RENOVACAO[codigo] || `Falha ao renovar a sessão (${codigo || `HTTP ${status}`}). Faça login de novo.`, {
        relogar: true,
      });
    }
    return { uid: corpo.user_id, idToken: corpo.id_token, refreshToken: corpo.refresh_token };
  }

  /** Lê licencas/{usuario}.acesso (número) ou null se o documento não existe. */
  async function lerAcesso(usuario, idToken) {
    const url =
      `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}` +
      `/databases/(default)/documents/licencas/${encodeURIComponent(usuario)}`;
    const { status, corpo } = await chamar(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (status === 200) return lerCampoAcesso(corpo);
    const msg = String(corpo?.error?.message ?? '');
    if (status === 404 && /database/i.test(msg)) throw new ErroLicenca('Firestore não foi criado no projeto (veja FIREBASE.md, passo 3).');
    if (status === 404) return null;
    if (status === 403) throw new ErroLicenca('Sem permissão para ler a licença. Confira as regras do Firestore (FIREBASE.md, passo 4).');
    throw new ErroLicenca(`Falha ao ler a licença (HTTP ${status}).`, { definitivo: false });
  }

  function avaliar(acesso) {
    if (acesso === ACESSO_LIBERADO) return null;
    if (acesso === null) return 'Este usuário não tem licença cadastrada. Fale com o suporte.';
    if (acesso === ACESSO_BLOQUEADO) return 'Acesso bloqueado. Regularize a assinatura ou fale com o suporte.';
    return `Acesso não liberado (valor ${acesso}). Fale com o suporte.`;
  }

  /** Login com usuário e senha (tela do iniciar.bat). -> { ok, usuario?, motivo? } */
  async function login(usuarioDigitado, senha) {
    if (!configurado()) return { ok: false, motivo: 'Firebase não configurado em src/firebase-config.js (veja FIREBASE.md).' };
    const usuario = normalizarUsuario(usuarioDigitado);
    if (!usuario) return { ok: false, motivo: 'Usuário inválido: use só letras, números, ponto, traço ou sublinhado.' };
    try {
      const s = await entrar(`${usuario}@${dominio}`, senha);
      const motivo = avaliar(await lerAcesso(usuario, s.idToken));
      salvarSessao({ usuario, refreshToken: s.refreshToken, liberadoEm: motivo ? null : agora() });
      return motivo ? { ok: false, motivo } : { ok: true, usuario };
    } catch (e) {
      return { ok: false, motivo: e.message, definitivo: e.definitivo };
    }
  }

  /**
   * Confere a sessão salva (ao iniciar e a cada 30 min).
   * -> { ok: true, usuario, aviso? } | { ok: false, motivo, definitivo }
   */
  async function verificarSessao() {
    if (!configurado()) return { ok: false, definitivo: true, motivo: 'Firebase não configurado em src/firebase-config.js (veja FIREBASE.md).' };
    const sessao = lerSessao();
    if (!sessao?.refreshToken || !sessao.usuario) {
      return { ok: false, definitivo: true, motivo: 'Nenhum login feito. Abra o iniciar.bat e entre com usuário e senha.' };
    }
    try {
      const s = await renovar(sessao.refreshToken);
      const motivo = avaliar(await lerAcesso(sessao.usuario, s.idToken));
      if (motivo) {
        salvarSessao({ ...sessao, refreshToken: s.refreshToken, liberadoEm: null });
        return { ok: false, definitivo: true, motivo };
      }
      salvarSessao({ ...sessao, refreshToken: s.refreshToken, liberadoEm: agora() });
      return { ok: true, usuario: sessao.usuario };
    } catch (e) {
      if (e.relogar) esquecerSessao();
      if (!e.definitivo && sessao.liberadoEm && agora() - sessao.liberadoEm < TOLERANCIA_OFFLINE_MS) {
        const horas = Math.ceil((TOLERANCIA_OFFLINE_MS - (agora() - sessao.liberadoEm)) / 3600000);
        return { ok: true, usuario: sessao.usuario, aviso: `${e.message} Seguindo com a última verificação (até ${horas}h sem conexão).` };
      }
      return { ok: false, definitivo: e.definitivo, motivo: e.definitivo ? e.message : `${e.message} Sem verificar a licença há mais de 24h.` };
    }
  }

  return { configurado, login, verificarSessao, lerSessao, esquecerSessao };
}

module.exports = {
  criarLicenca,
  lerCampoAcesso,
  normalizarUsuario,
  CODIGO_SAIDA_BLOQUEADO,
  INTERVALO_VERIFICACAO_MS,
  TOLERANCIA_OFFLINE_MS,
};
