// Guarda o histórico de conferências e o controle de mensagens já processadas.
//
// - resultados/conferencias_AAAA-MM.csv  -> abre no Excel (separador ";")
// - estado/processados.json              -> IDs de mensagens já tratadas, para não
//                                           processar o mesmo pedido duas vezes
// - estado/grupos.json                   -> grupos já vistos (na 1ª vez de um grupo, as
//                                           mensagens antigas dele são ignoradas)
// - estado/apelidos.json                 -> nomes de produto aprendidos com as respostas
//                                           no grupo Tratamento de Texto

const fs = require('fs');
const path = require('path');
const { agora, formatarReais, formatarQtdUnidade, log } = require('./util');

function lerJson(arquivo, padrao) {
  try {
    return fs.existsSync(arquivo) ? JSON.parse(fs.readFileSync(arquivo, 'utf8')) : padrao;
  } catch (e) {
    log(`⚠️  Não foi possível ler ${path.basename(arquivo)}: ${e.message}`);
    return padrao;
  }
}

class Registro {
  constructor(raiz) {
    this.pastaResultados = path.join(raiz, 'resultados');
    this.pastaEstado = path.join(raiz, 'estado');
    this.arquivoEstado = path.join(this.pastaEstado, 'processados.json');
    this.arquivoGrupos = path.join(this.pastaEstado, 'grupos.json');
    this.arquivoApelidos = path.join(this.pastaEstado, 'apelidos.json');
    fs.mkdirSync(this.pastaResultados, { recursive: true });
    fs.mkdirSync(this.pastaEstado, { recursive: true });

    this.processados = new Set(lerJson(this.arquivoEstado, []));
    this.grupos = new Set(lerJson(this.arquivoGrupos, []));
    this.apelidos = lerJson(this.arquivoApelidos, {}); // termo normalizado -> nome do produto
  }

  /** true na primeira vez que o grupo aparece (mensagens antigas dele devem ser ignoradas). */
  grupoNovo(id) {
    return !this.grupos.has(id);
  }

  marcarGrupo(id) {
    if (this.grupos.has(id)) return;
    this.grupos.add(id);
    fs.writeFileSync(this.arquivoGrupos, JSON.stringify([...this.grupos]));
  }

  salvarApelido(termo, nomeProduto) {
    this.apelidos[termo] = nomeProduto;
    try {
      fs.writeFileSync(this.arquivoApelidos, JSON.stringify(this.apelidos, null, 2));
    } catch (e) {
      log(`⚠️  Não foi possível salvar o apelido: ${e.message}`);
    }
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
    const itens = (resultado?.itens ?? []).map((i) => `${formatarQtdUnidade(i.quantidade, i.unidade)} ${i.nome}`).join(', ');
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
