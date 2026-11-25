// Perguntas no terminal (CMD): texto comum e senha oculta.

const readline = require('readline');

function perguntarLinha(texto) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(texto, (r) => {
      rl.close();
      resolve(r.trim());
    });
  });
}

/** Lê a senha sem mostrar o que é digitado (aparece * no lugar). */
function perguntarSenha(texto) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(texto);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let senha = '';
    const aoDigitar = (pedaco) => {
      for (const c of pedaco) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', aoDigitar);
          process.stdout.write('\n');
          return resolve(senha);
        }
        if (c === '\u0003') {
          process.stdout.write('\n');
          process.exit(1); // Ctrl+C
        }
        if (c === '\b' || c === '\x7f') {
          if (senha) {
            senha = senha.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (c < ' ') continue;
        senha += c;
        process.stdout.write('*');
      }
    };
    stdin.on('data', aoDigitar);
  });
}

module.exports = { perguntarLinha, perguntarSenha };
