// Gera o config.json do pacote do cliente a partir do seu config.json.
// Uso (feito pelo empacotar.ps1): node scripts/config-pacote.js <origem> <destino>
const fs = require('fs');
const [origem, destino] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(origem, 'utf8'));
config.chavePix = ''; // o cliente digita a dele na primeira abertura
config.debug = false;
config.chromePath = '';
fs.writeFileSync(destino, JSON.stringify(config, null, 2) + '\n');
