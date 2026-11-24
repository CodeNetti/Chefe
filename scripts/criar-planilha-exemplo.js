// Gera produtos.xlsx de exemplo (COD - Nome - Preço). Uso: npm run exemplo
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

async function criar(destino) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Produtos');
  ws.columns = [
    { header: 'COD', key: 'cod', width: 10 },
    { header: 'Nome', key: 'nome', width: 30 },
    { header: 'Preço', key: 'preco', width: 12, style: { numFmt: '"R$" #,##0.00' } },
  ];
  ws.addRows([
    { cod: 2121, nome: 'Alface', preco: 40 },
    { cod: 1010, nome: 'Tomate', preco: 7.5 },
    { cod: 3030, nome: 'Cebola', preco: 5.25 },
  ]);
  ws.getRow(1).font = { bold: true };
  await wb.xlsx.writeFile(destino);
  return destino;
}

if (require.main === module) {
  const destino = path.resolve(__dirname, '..', process.argv[2] || 'produtos.xlsx');
  if (fs.existsSync(destino) && !process.argv.includes('--forcar')) {
    console.log(`${destino} já existe (use --forcar para sobrescrever)`);
    process.exit(0);
  }
  criar(destino).then((d) => console.log('Planilha criada:', d));
}

module.exports = { criar };
