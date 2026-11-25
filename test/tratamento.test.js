const { test } = require('node:test');
const assert = require('node:assert');

const T = require('../src/tratamento');
const { parsePedido } = require('../src/parser');
const { conferir } = require('../src/conferencia');

// Planilha de teste com faixas de preço (mesmo Nome, COD diferente, coluna "A partir de")
function planilha(linhas) {
  return new Map(
    linhas.map(([codigo, nome, preco, apartirDe = null, apelidos = []]) => [
      codigo,
      { codigo, nome, preco: Math.round(preco * 100), apartirDe, apelidos },
    ])
  );
}
const produtos = planilha([
  ['A1', 'ItemA', 75],
  ['B1', 'ItemB', 73, 0],
  ['B2', 'ItemB', 70, 5],
  ['C1', 'ItemC', 60, 0],
  ['C2', 'ItemC', 50, 10],
  ['D1', 'ItemD', 27, 0],
  ['D2', 'ItemD', 23, 50],
  ['D3', 'ItemD', 21, 80],
  ['E1', 'ItemE', 23],
  ['F1', 'ItemF', 25],
  ['G1', 'ItemG', 73],
  ['2121', 'Alface', 40, null, ['alface crespa']],
  ['1010', 'Tomate', 7.5],
]);

/** Interpreta, exige que não haja pendências, monta e confere no formato do grupo Pedidos. */
function montar(texto, opts) {
  const rs = T.interpretarTudo(texto, produtos, opts);
  for (const r of rs) assert.strictEqual(T.proximaPendencia(r), null, JSON.stringify(T.proximaPendencia(r)));
  const pedidos = rs.flatMap((r) => T.montarPedidos(r, produtos));
  for (const p of pedidos) {
    const conf = conferir(parsePedido(p.texto), produtos, {});
    assert.ok(conf.ok, `${p.texto}\n-> ${conf.erros.join(' | ')}`);
    p.conferido = conf;
  }
  return pedidos;
}

test('exemplo 1: SUMMARY + valor por grama + total com conta + pickup', () => {
  const [p] = montar(
    'SUMMARY XKTP\n\n1g ItemA - 75\n8g ItemB - 70\n10g ItemC - 50\n50g ItemD - 23\n5g ItemE\n\ntotal : 75+560+500+1150+115=2.400\n\npickup/station'
  );
  assert.strictEqual(p.cliente, 'XKTP');
  assert.match(p.texto, /8g - ItemB - COD:B2 - R\$ 560,00/);
  assert.match(p.texto, /10g - ItemC - COD:C2 - R\$ 500,00/);
  assert.match(p.texto, /50g - ItemD - COD:D2 - R\$ 1\.150,00/);
  assert.match(p.texto, /5g - ItemE - COD:E1 - R\$ 115,00/);
  assert.match(p.texto, /Entrega: pickup\/station/);
  assert.match(p.texto, /Total: R\$ 2\.400,00/);
});

test('exemplo 2: Alias + Order + total em $', () => {
  const [p] = montar('Alias: Person1\n\nOrder:\n\n1g ItemF\n\nTotal: 25$');
  assert.strictEqual(p.cliente, 'Person1');
  assert.strictEqual(p.conferido.total, 2500);
});

test('exemplo 3: nome solto na 1ª linha, sem valores', () => {
  const [p] = montar('Person2\n\n11g ItemA');
  assert.strictEqual(p.cliente, 'Person2');
  assert.match(p.texto, /11g - ItemA - COD:A1 - R\$ 825,00/);
});

test('exemplo 4: valor da linha, cliente e local no fim', () => {
  const [p] = montar('10g ItemD - 270,00\n3g ItemB - 219,00\n3g ItemG - 219,00\n\nTotal R$ 708,00\n\nPerson3\nStation Place1');
  assert.strictEqual(p.cliente, 'Person3');
  assert.match(p.texto, /10g - ItemD - COD:D1 - R\$ 270,00/);
  assert.match(p.texto, /3g - ItemB - COD:B1 - R\$ 219,00/);
  assert.match(p.texto, /Entrega: Station Place1/);
});

test('exemplo 5: ruído, alias, "order:24g of", value e delivery', () => {
  const r = T.interpretarTudo('nice nice\nalias Person4\norder:24g of ItemD\nvalue: 648\ndelivery: Station Place2', produtos)[0];
  assert.deepStrictEqual(r.ignoradas, ['nice nice']);
  const [p] = T.montarPedidos(r, produtos);
  assert.strictEqual(p.cliente, 'Person4');
  assert.match(p.texto, /24g - ItemD - COD:D1 - R\$ 648,00/);
  assert.match(p.texto, /Entrega: Station Place2/);
});

test('exemplo 6: Summary sozinho, valor por grama sem traço, faixa de 80g', () => {
  const [p] = montar('Summary\nAlias Person5\n\n80g ItemD 21,00\n4g ItemC 60,00\n\nTotal: 1.920,00');
  assert.match(p.texto, /80g - ItemD - COD:D3 - R\$ 1\.680,00/);
  assert.match(p.texto, /4g - ItemC - COD:C1 - R\$ 240,00/);
});

test('colagem de várias mensagens do WhatsApp vira vários pedidos', () => {
  const texto =
    '[21:37, 24/11/2026] +55 11 90000-0000: Alias: Person1\n\nOrder:\n\n1g ItemF\n\nTotal: 25$\n' +
    '[21:37, 24/11/2026] +55 11 90000-0000: Person2\n\n11g ItemA\n' +
    '[21:38, 24/11/2026] +55 11 90000-0000: nice nice';
  const pedidos = montar(texto);
  assert.deepStrictEqual(pedidos.map((p) => p.cliente), ['Person1', 'Person2']);
});

test('um cliente por linha ("para") e erro de digitação no produto', () => {
  const pedidos = montar('1 alface para o colega Y\n3 toamte pra a ciclana');
  assert.deepStrictEqual(pedidos.map((p) => p.cliente), ['colega Y', 'ciclana']);
  assert.match(pedidos[0].texto, /1x - Alface - COD:2121 - R\$ 40,00/);
  assert.match(pedidos[1].texto, /3x - Tomate - COD:1010 - R\$ 22,50/);
});

test('sem cliente -> pergunta; resposta resolve', () => {
  const [r] = T.interpretarTudo('2 alface\n3 tomate', produtos);
  const pend = T.proximaPendencia(r);
  assert.strictEqual(pend.tipo, 'cliente');
  assert.ok(T.aplicarResposta(r, pend, 'Maria Souza', produtos).ok);
  assert.strictEqual(T.proximaPendencia(r), null);
  assert.strictEqual(T.montarPedidos(r, produtos)[0].cliente, 'Maria Souza');
});

test('vários nomes soltos -> agenda desempata', () => {
  const [r] = T.interpretarTudo('oi tudo bem\nAna Paula\n2 alface', produtos, { contatos: ['Ana Paula', 'Zé'] });
  assert.strictEqual(r.clienteGeral, 'Ana Paula');
});

test('produto desconhecido -> pergunta; resposta vira apelido', () => {
  const [r] = T.interpretarTudo('Cliente: Ana\n2 verdinha', produtos);
  const pend = T.proximaPendencia(r);
  assert.strictEqual(pend.tipo, 'produto');
  const res = T.aplicarResposta(r, pend, '2121', produtos);
  assert.ok(res.ok);
  assert.deepStrictEqual(res.apelido, { termo: 'verdinha', nome: 'Alface' });
  // Da próxima vez, o apelido aprendido resolve sozinho
  const [r2] = T.interpretarTudo('Cliente: Ana\n2 verdinhas', produtos, { aprendidos: { verdinha: 'Alface' } });
  assert.strictEqual(T.proximaPendencia(r2), null);
});

test('produto ambíguo -> opções numeradas', () => {
  const p2 = planilha([
    ['3001', 'Alface Crespa', 5],
    ['3002', 'Alface Roxa', 6],
  ]);
  const [r] = T.interpretarTudo('Cliente: Ana\n2 alface roxa\n1 alface\n1 alfaçe crespa', p2);
  assert.strictEqual(r.itens[0].grupo.nome, 'Alface Roxa');
  assert.strictEqual(r.itens[2].grupo.nome, 'Alface Crespa');
  const pend = T.proximaPendencia(r);
  assert.strictEqual(pend.tipo, 'produto');
  assert.strictEqual(pend.opcoes.length, 2);
  assert.ok(T.aplicarResposta(r, pend, '2', p2).ok);
  assert.strictEqual(r.itens[1].grupo.nome, 'Alface Roxa');
  assert.strictEqual(T.proximaPendencia(r), null);
});

test('item removido com 0 e mensagem comum não vira pedido', () => {
  const [r] = T.interpretarTudo('Cliente: Ana\n2 alface\n1 xyzabc', produtos);
  assert.ok(T.aplicarResposta(r, T.proximaPendencia(r), '0', produtos).ok);
  assert.strictEqual(T.montarPedidos(r, produtos)[0].texto.includes('xyz'), false);
  assert.deepStrictEqual(T.interpretarTudo('bom dia pessoal', produtos), []);
});

test('respostas curtas não parecem item; itens parecem', () => {
  assert.strictEqual(T.pareceItem('2'), false);
  assert.strictEqual(T.pareceItem('5g'), false);
  assert.strictEqual(T.pareceItem('Ana Paula'), false);
  assert.strictEqual(T.pareceItem('3 tomate para Ana'), true);
});

// ---------- mensagens reais (24/11/2026) ----------

// Igual à produtos.xlsx: faixas escritas como texto ("<50 g", "≥50 e <100 g")
const { lerFaixa } = require('../src/catalogo');
const real = new Map(
  [
    ['2121', 'Alface', 40, ''],
    ['1010', 'Tomate', 75, ''],
    ['3030', 'Cebola', 525, ''],
    ['4010', 'Produto X', 75, '<50 g'],
    ['4020', 'Produto X', 70, '≥50 e <100 g'],
  ].map(([codigo, nome, preco, faixa]) => [codigo, { codigo, nome, preco: preco * 100, ...lerFaixa(faixa), apelidos: [] }])
);

/** Interpreta sem pendências, monta e confere. Devolve { texto, conf } do único pedido. */
function montarReal(texto) {
  const rs = T.interpretarTudo(texto, real);
  assert.strictEqual(rs.length, 1, 'esperava 1 pedido');
  assert.strictEqual(T.proximaPendencia(rs[0]), null, JSON.stringify(T.proximaPendencia(rs[0])));
  const [p] = T.montarPedidos(rs[0], real);
  return { texto: p.texto, conf: conferir(parsePedido(p.texto), real, {}) };
}

test('faixa escrita como texto na planilha', () => {
  assert.deepStrictEqual(lerFaixa('<50 g'), { apartirDe: 0, ate: { valor: 50, inclusivo: false } });
  assert.deepStrictEqual(lerFaixa('≥50 e <100 g'), { apartirDe: 50, ate: { valor: 100, inclusivo: false } });
  assert.deepStrictEqual(lerFaixa('50 a 99'), { apartirDe: 50, ate: { valor: 99, inclusivo: true } });
  assert.deepStrictEqual(lerFaixa('até 49'), { apartirDe: 0, ate: { valor: 49, inclusivo: true } });
  assert.deepStrictEqual(lerFaixa('50+'), { apartirDe: 50, ate: null });
  assert.deepStrictEqual(lerFaixa(50), { apartirDe: 50, ate: null });
  assert.deepStrictEqual(lerFaixa(''), { apartirDe: null, ate: null });
  assert.strictEqual(lerFaixa('abc'), null);
  // 60g cai na 2ª faixa; 120g fica fora de todas
  assert.match(montarReal('Vulgo: Ana\n60g Produto X').texto, /COD:4020 - R\$ 4\.200,00/);
  assert.match(conferir(parsePedido('Cliente: Ana\n120g - Produto X - COD:4020 - R$8.400'), real, {}).erros[0], /fora das faixas/);
});

test('real 1: saudação ignorada, produto = valor sem quantidade, frete Motoca', () => {
  const { texto, conf } = montarReal(
    'Salve chefe bom dia!!\nIrmão vou adiantar o resumo, pra derrepente já liberar hoje, dentro do possível\n\nVenec\nAlface = R$40,00\nTomate = R$ 75,00\nMotoca = 70,00\nTotal 185,00'
  );
  assert.match(texto, /^Cliente: Venec/);
  assert.match(texto, /1x - Alface - COD:2121 - R\$ 40,00/);
  assert.match(texto, /Entrega: Motoca\nFrete: R\$ 70,00\nTotal: R\$ 185,00/);
  assert.ok(conf.ok, conf.erros.join(' | '));
  assert.strictEqual(conf.frete, 7000);
});

test('real 2: RESUMO + nome com emoji + Retirada', () => {
  const { texto, conf } = montarReal('RESUMO\nINK ✅\n2x Tomate\n2x Cebola\n1x Produto X\n\nRetirada');
  assert.match(texto, /^Cliente: INK\n/);
  assert.match(texto, /1x - Produto X - COD:4010/);
  assert.match(texto, /Entrega: Retirada/);
  assert.ok(conf.ok);
});

test('real 3: tudo numa linha (Vulgo cond$  10g Produto X.  Total)', () => {
  for (const msg of ['Resumo:\n\nVulgo cond$  10g Produto X.  Total R$ 750,00', 'Vulgo cond$ 10g Produto X. Total R$ 750,00']) {
    const { texto, conf } = montarReal(msg);
    assert.match(texto, /^Cliente: cond\$\n/);
    assert.match(texto, /10g - Produto X - COD:4010 - R\$ 750,00/);
    assert.ok(conf.ok);
  }
});

test('real 4 e 8: preço diferente da planilha é apontado na conferência', () => {
  const m4 = montarReal('Resumo:\n\nVeríticos\n\n20g Produto X = R$ 1.400,00\n\nTotal: R$ 1.400,00');
  assert.match(m4.texto, /^Cliente: Veríticos/);
  assert.match(m4.conf.erros[0], /correto R\$ 1\.500,00/);
  const m8 = montarReal('resumo\nvulgo:gusta\npedido\n\n28g Produto X >>>> R$ 1.960,00\n6g Cebola >>>> R$ 3.150,00\n\ntotal: R$ 5.110,00');
  assert.match(m8.texto, /^Cliente: gusta/);
  assert.match(m8.texto, /6g - Cebola - COD:3030 - R\$ 3\.150,00/);
  assert.match(m8.conf.erros[0], /28g Produto X: informado R\$ 1\.960,00, correto R\$ 2\.100,00/);
});

test('real 5, 6, 9, 10: Resumo Nome, Vulgo: Nome, pedido: ... de, Pix ignorado', () => {
  const casos = [
    ['Resumo Peach\n\n20g - Tomate\n\nTotal: R$ 1.500,00', 'Peach'],
    ['Vulgo: sgobi\n\n5g Produto X = R$ 375,00\n\nTotal: R$ 375,00', 'sgobi'],
    ['vulgo:manu\npedido: 15g de Produto X\nvalor: R$ 1.125,00\nentrega: estação lapa', 'manu'],
    ['VB\n\n4g Produto X - R$ 300,00\n\nTotal R$ 300,00\nPix', 'VB'],
  ];
  for (const [msg, cliente] of casos) {
    const { texto, conf } = montarReal(msg);
    assert.match(texto, new RegExp(`^Cliente: ${cliente}\n`));
    assert.ok(conf.ok, `${texto}\n-> ${conf.erros.join(' | ')}`);
  }
  assert.match(montarReal(casos[2][0]).texto, /Entrega: estação lapa/);
});

test('real 7: FRETE com endereço e "total ... + frete"', () => {
  const { texto, conf } = montarReal(
    'Vulgo: Tazz\n20g Tomate: R$ 1.500,00\n5g Produto X: R$ 375,00\n2g Cebola: R$ 1.050,00\n\nFRETE: Motoca (Rua guiará 325)\n\ntotal R$ 2.925,00 + frete'
  );
  assert.match(texto, /Entrega: Motoca \(Rua guiará 325\)/);
  assert.doesNotMatch(texto, /Frete:/); // valor do frete não informado
  assert.match(texto, /Total: R\$ 2\.925,00/);
  assert.ok(conf.ok);
  // Com o valor do frete informado, o total passa a incluí-lo
  const com = montarReal('Vulgo: Tazz\n20g Tomate: R$ 1.500,00\nFrete: R$ 20,00\ntotal R$ 1.500,00 + frete');
  assert.match(com.texto, /Frete: R\$ 20,00\nTotal: R\$ 1\.520,00/);
  assert.ok(com.conf.ok);
});

test('real 11: VULGO e FORMA DE ENTREGA com o valor na linha de baixo / sem dois-pontos, quantidade depois do nome', () => {
  const { texto, conf } = montarReal(
    'VULGO\nKelvão\n\nPEDIDO\nCebola 1g - R$ 525,00\nTomate 2g − R$ 150,00\n\nVALOR TOTAL R$ 675,00\nFORMA DE ENTREGA Lapa'
  );
  assert.match(texto, /^Cliente: Kelvão\n/);
  assert.match(texto, /1g - Cebola - COD:3030 - R\$ 525,00\n2g - Tomate - COD:1010 - R\$ 150,00/);
  assert.match(texto, /Entrega: Lapa\n/);
  assert.ok(conf.ok);
  // Rótulo de entrega sozinho na linha
  assert.match(montarReal('Vulgo: Ana\n2x Tomate\nFORMA DE ENTREGA\nLapa').texto, /Entrega: Lapa/);
});

// ---------- bug de 25/11/2026: confirmação relida após reiniciar virava pedido repetido ----------

test('mensagens do próprio sistema são reconhecidas (e pedidos normais não)', () => {
  const M = require('../src/mensagens');
  const conf = M.mensagemConfirmacaoTratamento([{ texto: 'Cliente: Ana\nPedido\n4g - Produto X - COD:4010 - R$ 300,00' }]);
  assert.ok(M.ehMensagemDoSistema(conf));
  const pergunta = M.mensagemPerguntaTratamento(
    { itens: [{ termo: 'xyz', linha: '1 xyz', opcoes: [] }] },
    { tipo: 'produto', i: 0, opcoes: [] }
  );
  assert.ok(M.ehMensagemDoSistema(pergunta));
  assert.ok(M.ehMensagemDoSistema(M.mensagemErroGrupo({ cliente: 'Ana', erros: ['x'] })));
  assert.ok(M.ehMensagemDoSistema('🚫 Nada para enviar: todos os itens foram retirados.'));
  for (const pedido of ['Cliente: Ana\n2x - Alface - COD:2121 - R$80', 'Vulgo: Ana\n2 alface', 'RESUMO\nINK ✅\n2x Tomate']) {
    assert.strictEqual(M.ehMensagemDoSistema(pedido), false, pedido);
  }
});
