// Guarda o histórico de conferências e o controle de mensagens já processadas.
//
// - resultados/conferencias_AAAA-MM.csv  -> abre no Excel (separador ";")
// - estado/processados.json              -> IDs de mensagens já tratadas, para não
//                                           processar o mesmo pedido duas vezes

const fs = require('fs');
const path = require('path');
const { agora, formatarReais, log } = require('./util');

class Registro {
  constructor(raiz) {
    this.pastaResultados = path.join(raiz, 'resultados');
    this.pastaEstado = path.join(raiz, 'estado');
    this.arquivoEstado = path.join(this.pastaEstado, 'processados.json');
    fs.mkdirSync(this.pastaResultados, { recursive: true });
    fs.mkdirSync(this.pastaEstado, { recursive: true });

    this.primeiraExecucao = !fs.existsSync(this.arquivoEstado);
    this.processados = new Set(
      this.primeiraExecucao ? [] : JSON.parse(fs.readFileSync(this.arquivoEstado, 'utf8'))
    );
  }

  jaProcessado(id) {
    return this.processados.has(id);
  }

  marcarProcessado(id) {
    this.processados.add(id);
    // Mantém só os 5000 mais recentes
    const lista = [...this.processados].slice(-5000);
    this.processados = new Set(lista);
    fs.writeFileSync(this.arquivoEstado, JSON.stringify(lista));
  }

  /** status: OK | ERRO | NAO_ENVIADO | FALHA */
  anotar(status, resultado, detalhe = '') {
    const d = new Date();
    const arquivo = path.join(
      this.pastaResultados,
      `conferencias_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.csv`
    );
    const celula = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' | ')}"`;
    const itens = (resultado?.itens ?? []).map((i) => `${i.quantidade}x ${i.nome}`).join(', ');
    const linha = [
      agora(),
      status,
      resultado?.cliente,
      itens,
      resultado ? formatarReais(resultado.total) : '',
      detalhe || (resultado?.erros ?? []).join(' | '),
    ]
      .map(celula)
      .join(';');

    try {
      if (!fs.existsSync(arquivo)) {
        // BOM para o Excel abrir acentos corretamente
        fs.writeFileSync(arquivo, '﻿' + ['Data/Hora', 'Status', 'Cliente', 'Itens', 'Total', 'Detalhes'].join(';') + '\n');
      }
      fs.appendFileSync(arquivo, linha + '\n');
    } catch (e) {
      log(`⚠️  Não foi possível gravar o relatório (arquivo aberto no Excel?): ${e.message}`);
    }
  }
}

module.exports = { Registro };
