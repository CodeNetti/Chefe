const { test } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const { parsePedido } = require('../src/parser');
const { conferir } = require('../src/conferencia');
const { lerPlanilha } = require('../src/catalogo');
const { paraCentavos, formatarReais } = require('../src/util');
const M = require('../src/mensagens');
const { criar } = require('../scripts/criar-planilha-exemplo');

const config = {
  toleranciaCentavos: 0,
  exigirTotal: false,
  mensagemCliente: 'Olá, {cliente}!\n\n{itens}\n\nTotal: {total}',
  modeloItem: '{qtd}x {nome} — {valor}',
};

let produtos;
test('carrega planilha exemplo', async () => {
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ddc-')), 'p.xlsx');
  await criar(arq);
  ({ produtos } = await lerPlanilha(arq));
  assert.strictEqual(produtos.size, 3);
  assert.deepStrictEqual(produtos.get('2121'), { codigo: '2121', nome: 'Alface', preco: 4000 });
  assert.strictEqual(produtos.get('3030').preco, 525);
});

test('valores em reais', () => {
  assert.strictEqual(paraCentavos('R$80'), 8000);
  assert.strictEqual(paraCentavos('R$ 1.234,56'), 123456);
  assert.strictEqual(paraCentavos('22,5'), 2250);
  assert.strictEqual(paraCentavos('80.50'), 8050);
  assert.strictEqual(paraCentavos('1.234'), 123400);
  assert.strictEqual(paraCentavos('abc'), null);
  assert.strictEqual(formatarReais(123456), 'R$ 1.234,56');
});

test('mensagem comum não é pedido', () => {
  assert.strictEqual(parsePedido('Bom dia pessoal'), null);
  assert.strictEqual(parsePedido('✅ *Conferido e enviado para Gustavo*\n...'), null);
});

test('pedido correto (exemplo do usuário)', () => {
  const p = parsePedido('Cliente : Gustavo\nPedido\n2x - Alface - COD:2121 - R$80');
  assert.strictEqual(p.cliente, 'Gustavo');
  const r = conferir(p, produtos, config);
  assert.ok(r.ok, r.erros.join());
  assert.strictEqual(r.total, 8000);

  const texto = M.mensagemCliente(r, config);
  assert.match(texto, /2x Alface — R\$ 80,00/);
  assert.doesNotMatch(texto, /2121/, 'código não pode ir para o cliente');
});

test('pedido com vários itens, total e formatação do WhatsApp', () => {
  const p = parsePedido(
    '*Cliente: Gustavo*\n*Pedido*\n2x - Alface - COD:2121 - R$80,00\n3x - COD: 1010 - R$ 22,50\n1,5x - Cebola - COD 3030 - R$7,88\n*Total: R$ 110,38*'
  );
  const r = conferir(p, produtos, config);
  assert.ok(r.ok, r.erros.join());
  assert.strictEqual(r.total, 11038);
});

test('valor errado na linha', () => {
  const r = conferir(parsePedido('Cliente: Ana\n2x - Alface - COD:2121 - R$70'), produtos, config);
  assert.strictEqual(r.ok, false);
  assert.match(r.erros[0], /informado R\$ 70,00, correto R\$ 80,00/);
});

test('código inexistente', () => {
  const r = conferir(parsePedido('Cliente: Ana\n1x - Banana - COD:9999 - R$5'), produtos, config);
  assert.strictEqual(r.ok, false);
  assert.match(r.erros[0], /COD 9999 não existe/);
});

test('total errado', () => {
  const r = conferir(parsePedido('Cliente: Ana\n2x - Alface - COD:2121 - R$80\nTotal: R$90'), produtos, config);
  assert.strictEqual(r.ok, false);
  assert.match(r.erros[0], /Total informado R\$ 90,00/);
});

test('linha fora do padrão e item sem COD', () => {
  const r = conferir(parsePedido('Cliente: Ana\n2x - Alface - R$80\nentregar cedo'), produtos, config);
  assert.strictEqual(r.ok, false);
  assert.match(r.erros.join('\n'), /COD ausente/);
  assert.match(r.erros.join('\n'), /Linha não reconhecida: "entregar cedo"/);
});

test('total obrigatório quando configurado', () => {
  const r = conferir(parsePedido('Cliente: Ana\n2x - Alface - COD:2121 - R$80'), produtos, { ...config, exigirTotal: true });
  assert.strictEqual(r.ok, false);
});

test('mensagens do grupo nunca são lidas como pedido', () => {
  const r = conferir(parsePedido('Cliente: Ana\n2x - Alface - COD:2121 - R$70'), produtos, config);
  assert.strictEqual(parsePedido(M.mensagemErroGrupo(r)), null);
  assert.strictEqual(parsePedido(M.mensagemControleGrupo(r, 'x')), null);
  assert.strictEqual(parsePedido(M.mensagemFalhaEnvioGrupo(r, 'x')), null);
});
