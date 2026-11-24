// Funções utilitárias: normalização de texto e conversão de valores em reais.
// Todos os valores monetários são tratados em CENTAVOS (inteiros) para evitar
// erros de arredondamento de ponto flutuante.

/** Remove acentos, espaços extras e deixa minúsculo. Usado para comparar nomes. */
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Normaliza um código de produto: sem espaços, maiúsculo. */
function normalizarCodigo(codigo) {
  return String(codigo ?? '').replace(/\s+/g, '').toUpperCase();
}

/**
 * Converte um número (decimal) em texto padrão BR ou número JS para centavos.
 * Aceita: 80 | "80" | "80,00" | "R$ 1.234,56" | "80.5" | "1.234"
 * Retorna null se não for possível interpretar.
 */
function paraCentavos(valor) {
  if (typeof valor === 'number') {
    return Number.isFinite(valor) ? Math.round(valor * 100) : null;
  }
  let s = String(valor ?? '').replace(/R\$/i, '').replace(/\s+/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    // Formato brasileiro: ponto = milhar, vírgula = decimal
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (!/^\d+\.\d{1,2}$/.test(s)) {
    // Sem vírgula e sem "x.yy": pontos são separadores de milhar
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

/** Converte quantidade "2" | "1,5" | "1.5" em número. */
function paraQuantidade(texto) {
  const n = parseFloat(String(texto).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const formatadorBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** 8000 -> "R$ 80,00" */
function formatarReais(centavos) {
  return formatadorBRL.format(centavos / 100).replace(/ /g, ' ');
}

/** 2 -> "2" | 1.5 -> "1,5" */
function formatarQuantidade(qtd) {
  return String(qtd).replace('.', ',');
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Espera aleatória entre min e max ms (deixa o ritmo mais "humano"). */
function esperarAleatorio(min = 800, max = 2000) {
  return esperar(min + Math.random() * (max - min));
}

function agora() {
  return new Date().toLocaleString('pt-BR');
}

function log(...args) {
  console.log(`[${agora()}]`, ...args);
}

module.exports = {
  normalizar,
  normalizarCodigo,
  paraCentavos,
  paraQuantidade,
  formatarReais,
  formatarQuantidade,
  esperar,
  esperarAleatorio,
  agora,
  log,
};
