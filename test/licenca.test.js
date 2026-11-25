const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { criarLicenca, lerCampoAcesso, normalizarUsuario, TOLERANCIA_OFFLINE_MS } = require('../src/licenca');

const CONFIG = { apiKey: 'AIzaTESTE', projectId: 'projeto-teste', dominioUsuarios: 'chefe.local' };

/**
 * Firebase de mentira: contas { email: { senha, uid } }, licencas { usuario: acesso | undefined }.
 * Regras como as de firestore.rules: só lê licencas/{usuario} quem entrou como usuario@chefe.local.
 * fb.offline = true simula queda de internet.
 */
function firebaseFalso({ usuarios = {}, licencas = {}, regras = true } = {}) {
  const estado = { offline: false, refreshValidos: new Map(), tokens: new Map() };
  const json = (status, corpo) => ({ status, json: async () => corpo });
  estado.fetch = async (url, op = {}) => {
    if (estado.offline) throw new Error('fetch failed');
    if (url.includes('signInWithPassword')) {
      const { email, password } = JSON.parse(op.body);
      const u = usuarios[email];
      if (!u || u.senha !== password) return json(400, { error: { message: 'INVALID_LOGIN_CREDENTIALS' } });
      const rt = `rt-${u.uid}-${Math.random()}`;
      estado.refreshValidos.set(rt, email);
      estado.tokens.set(`id-${u.uid}`, email);
      return json(200, { localId: u.uid, idToken: `id-${u.uid}`, refreshToken: rt });
    }
    if (url.includes('securetoken')) {
      const rt = new URLSearchParams(op.body).get('refresh_token');
      const email = estado.refreshValidos.get(rt);
      if (!email) return json(400, { error: { message: 'TOKEN_EXPIRED' } });
      const uid = usuarios[email].uid;
      return json(200, { user_id: uid, id_token: `id-${uid}`, refresh_token: rt });
    }
    if (url.includes('firestore')) {
      const usuario = decodeURIComponent(url.split('/licencas/')[1]);
      const emailDoToken = estado.tokens.get(String(op.headers?.Authorization).replace('Bearer ', ''));
      if (!regras || emailDoToken !== `${usuario}@chefe.local`) return json(403, { error: { message: 'PERMISSION_DENIED' } });
      if (licencas[usuario] === undefined) return json(404, { error: { message: `Document licencas/${usuario} was not found.` } });
      return json(200, { fields: { acesso: { integerValue: String(licencas[usuario]) } } });
    }
    return json(404, {});
  };
  return estado;
}

function montar(fb, { agora = () => 1_000_000, config = CONFIG } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'ddc-lic-'));
  return { raiz, lic: criarLicenca({ raiz, config, fetch: fb.fetch, agora }) };
}

const usuarios = { 'ana@chefe.local': { senha: 'certa', uid: 'UID_ANA' } };

test('acesso = 1 libera; sessão salva sem a senha', async () => {
  const fb = firebaseFalso({ usuarios, licencas: { ana: 1 } });
  const { raiz, lic } = montar(fb);
  assert.deepStrictEqual(await lic.login('ana', 'certa'), { ok: true, usuario: 'ana' });
  const salvo = fs.readFileSync(path.join(raiz, 'estado', 'licenca.json'), 'utf8');
  assert.doesNotMatch(salvo, /certa/);
  assert.strictEqual(JSON.parse(salvo).usuario, 'ana');
  assert.deepStrictEqual(await lic.verificarSessao(), { ok: true, usuario: 'ana' });
});

test('acesso = 2 bloqueia; sem documento bloqueia; senha errada', async () => {
  const fb = firebaseFalso({ usuarios, licencas: { ana: 2 } });
  const { lic } = montar(fb);
  const r = await lic.login('ana', 'certa');
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /bloqueado/);
  assert.match((await lic.login('ana', 'errada')).motivo, /Usuário ou senha incorretos/);
  assert.match((await lic.login('maria', 'certa')).motivo, /Usuário ou senha incorretos/);

  const semDoc = montar(firebaseFalso({ usuarios, licencas: {} })).lic;
  assert.match((await semDoc.login('ana', 'certa')).motivo, /não tem licença cadastrada/);
});

test('bloqueio feito depois do login é pego na próxima verificação', async () => {
  const licencas = { ana: 1 };
  const { lic } = montar(firebaseFalso({ usuarios, licencas }));
  assert.ok((await lic.login('ana', 'certa')).ok);
  licencas.ana = 2;
  const v = await lic.verificarSessao();
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.definitivo, true);
  licencas.ana = 1;
  assert.ok((await lic.verificarSessao()).ok);
});

test('sem internet: tolera 24h desde a última liberação, depois para', async () => {
  let agora = 1_000_000;
  const fb = firebaseFalso({ usuarios, licencas: { ana: 1 } });
  const { lic } = montar(fb, { agora: () => agora });
  assert.ok((await lic.login('ana', 'certa')).ok);
  fb.offline = true;
  agora += TOLERANCIA_OFFLINE_MS - 60_000;
  const dentro = await lic.verificarSessao();
  assert.strictEqual(dentro.ok, true);
  assert.match(dentro.aviso, /Sem conexão/);
  agora += 120_000;
  const fora = await lic.verificarSessao();
  assert.strictEqual(fora.ok, false);
  assert.match(fora.motivo, /mais de 24h/);
});

test('sem internet e nunca liberado: não entra', async () => {
  const fb = firebaseFalso({ usuarios, licencas: { ana: 2 } });
  const { lic } = montar(fb);
  await lic.login('ana', 'certa'); // bloqueado
  fb.offline = true;
  assert.strictEqual((await lic.verificarSessao()).ok, false);
});

test('sessão revogada (senha trocada) pede login de novo e guarda só o usuário', async () => {
  const fb = firebaseFalso({ usuarios, licencas: { ana: 1 } });
  const { lic } = montar(fb);
  assert.ok((await lic.login('ana', 'certa')).ok);
  fb.refreshValidos.clear();
  const v = await lic.verificarSessao();
  assert.strictEqual(v.ok, false);
  assert.match(v.motivo, /Faça login de novo/);
  assert.deepStrictEqual(lic.lerSessao(), { usuario: 'ana' });
});

test('sem login, sem configuração e regras erradas', async () => {
  const fb = firebaseFalso({ usuarios, licencas: { ana: 1 }, regras: false });
  assert.match((await montar(fb).lic.verificarSessao()).motivo, /Nenhum login feito/);
  assert.match((await montar(fb).lic.login('ana', 'certa')).motivo, /regras do Firestore/);
  const semConfig = montar(fb, { config: { apiKey: '', projectId: '' } }).lic;
  assert.strictEqual(semConfig.configurado(), false);
  assert.match((await semConfig.verificarSessao()).motivo, /não configurado/);
});

test('usuário: maiúsculas e acentos não importam; caracteres inválidos são recusados', async () => {
  assert.strictEqual(normalizarUsuario(' João.Silva '), 'joao.silva');
  assert.strictEqual(normalizarUsuario('ana_2'), 'ana_2');
  assert.strictEqual(normalizarUsuario('ana silva'), null);
  assert.strictEqual(normalizarUsuario('ana@x.com'), null);
  const fb = firebaseFalso({ usuarios, licencas: { ana: 1 } });
  assert.deepStrictEqual(await montar(fb).lic.login('  ANA ', 'certa'), { ok: true, usuario: 'ana' });
  assert.match((await montar(fb).lic.login('ana silva', 'certa')).motivo, /Usuário inválido/);
});

test('cada um só lê a própria licença', async () => {
  const fb = firebaseFalso({
    usuarios: { ...usuarios, 'bia@chefe.local': { senha: 'x', uid: 'UID_BIA' } },
    licencas: { ana: 1, bia: 2 },
  });
  const r = await montar(fb).lic.login('bia', 'x');
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /bloqueado/);
});

test('campo acesso: número ou texto', () => {
  assert.strictEqual(lerCampoAcesso({ fields: { acesso: { integerValue: '1' } } }), 1);
  assert.strictEqual(lerCampoAcesso({ fields: { acesso: { doubleValue: 2 } } }), 2);
  assert.strictEqual(lerCampoAcesso({ fields: { acesso: { stringValue: '1' } } }), 1);
  assert.strictEqual(lerCampoAcesso({ fields: {} }), null);
});
