const { test } = require('node:test');
const assert = require('node:assert');
const { resolverDestino, normalizarTelefone, formatarTelefone } = require('../src/contatos');
const { parsePedido } = require('../src/parser');

// Cliente falso: listarContatos() chama pupPage.evaluate e recebe esta lista
function clienteFalso(contatos, numerosValidos = {}) {
  return {
    pupPage: { evaluate: async () => contatos },
    getNumberId: async (n) => (numerosValidos[n] ? { _serialized: `${n}@c.us`, user: n } : null),
  };
}

const mariaDuplicada = [
  { id: '10000000000001@lid', nome: 'Maria Souza', pushname: '', numero: '10000000000001' },
  { id: '5511999990000@c.us', nome: 'Maria Souza', pushname: '', numero: '5511999990000' },
];

test('caso real: mesmo contato como @lid e telefone -> usa o telefone 55', async () => {
  const r = await resolverDestino(clienteFalso(mariaDuplicada), 'maria souza', null, '55');
  assert.strictEqual(r.contato?.id, '5511999990000@c.us');
});

test('prioriza prefixo 55 entre telefones', async () => {
  const r = await resolverDestino(
    clienteFalso([
      { id: '14155550100@c.us', nome: 'Ana', numero: '14155550100' },
      { id: '5511912345678@c.us', nome: 'Ana', numero: '5511912345678' },
    ]),
    'Ana', null, '55'
  );
  assert.strictEqual(r.contato?.numero, '5511912345678');
});

test('dois telefones 55 com o mesmo nome -> opções para escolher', async () => {
  const r = await resolverDestino(
    clienteFalso([
      { id: '5511911111111@c.us', nome: 'Ana', numero: '5511911111111' },
      { id: '5521922222222@c.us', nome: 'Ana', numero: '5521922222222' },
    ]),
    'Ana', null, '55'
  );
  assert.ok(!r.contato);
  assert.strictEqual(r.opcoes.length, 2);
});

test('contato inexistente -> sem opções (pede telefone)', async () => {
  const r = await resolverDestino(clienteFalso([]), 'Zé', null, '55');
  assert.ok(r.erro);
  assert.deepStrictEqual(r.opcoes, []);
});

test('"Enviar para" com telefone valida o número', async () => {
  const c = clienteFalso([], { '5511999990000': true });
  assert.strictEqual((await resolverDestino(c, 'X', '(11) 99999-0000', '55')).contato.id, '5511999990000@c.us');
  assert.match((await resolverDestino(c, 'X', '11 90000-0000', '55')).erro, /não tem WhatsApp/);
});

test('"Enviar para" com nome procura o outro contato', async () => {
  const r = await resolverDestino(clienteFalso(mariaDuplicada), 'Gustavo', 'Maria Souza', '55');
  assert.strictEqual(r.contato?.numero, '5511999990000');
});

test('telefones', () => {
  assert.strictEqual(normalizarTelefone('(11) 99999-0000'), '5511999990000');
  assert.strictEqual(normalizarTelefone('+55 11 99999-0000'), '5511999990000');
  assert.strictEqual(normalizarTelefone('123'), null);
  assert.strictEqual(formatarTelefone('5511999990000'), '+55 11 99999-0000');
});

test('parser lê "Enviar para"', () => {
  const p = parsePedido('Cliente: Gustavo\nEnviar para: 11999990000\n2x - Alface - COD:2121 - R$80');
  assert.strictEqual(p.destino, '11999990000');
  assert.deepStrictEqual(p.erros, []);
});
