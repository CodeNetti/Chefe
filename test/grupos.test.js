const { test } = require('node:test');
const assert = require('node:assert');
const { escolherGrupo, explicarErroGrupo } = require('../src/whatsapp');

test('grupo antigo somente leitura com o mesmo nome é ignorado (caso real 25/11/2026)', () => {
  const grupos = [
    { id: 'novo@g.us', nome: 'Pedidos Teste', somenteLeitura: false },
    { id: 'antigo@g.us', nome: 'PEDIDOS TESTE', somenteLeitura: true },
    { id: 'outro@g.us', nome: 'Família', somenteLeitura: false },
  ];
  assert.deepStrictEqual(escolherGrupo(grupos, 'Pedidos Teste'), { grupo: grupos[0], ignorados: 1 });
});

test('dois grupos ativos com o mesmo nome: erro; só o de somente leitura: explica', () => {
  const dois = [
    { id: 'a@g.us', nome: 'Pedidos', somenteLeitura: false },
    { id: 'b@g.us', nome: 'pedidos', somenteLeitura: false },
  ];
  const r = escolherGrupo(dois, 'Pedidos');
  assert.deepStrictEqual(r, { erro: 'duplicado', quantidade: 2 });
  assert.match(explicarErroGrupo(r, 'Pedidos'), /2 grupos ativos/);

  const so = escolherGrupo([{ id: 'a@g.us', nome: 'Pedidos', somenteLeitura: true }], 'Pedidos');
  assert.deepStrictEqual(so, { erro: 'somente_leitura' });
  assert.match(explicarErroGrupo(so, 'Pedidos'), /não pode enviar/);

  assert.deepStrictEqual(escolherGrupo([], 'Pedidos'), { erro: 'nao_encontrado' });
});
