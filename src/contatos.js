// Descobre para quem enviar o pedido conferido.
//
// Por nome (padrão): usa o nome SALVO na agenda (ignora acentos e maiúsculas).
//   - O WhatsApp às vezes guarda o mesmo contato duas vezes: pelo telefone (@c.us)
//     e por um ID interno (@lid, ex.: 10000000000001). O telefone sempre tem prioridade.
//   - Entre telefones, os que começam com o prefixo preferido (config, padrão "55") vencem.
//   - Se ainda sobrar mais de um, ou nenhum, devolve `opcoes` para escolha no grupo.
//
// Por número: valida no WhatsApp e devolve o contato.

const { normalizar } = require('./util');
const { listarContatos, comTimeout } = require('./whatsapp');

/** "11999990000" | "+55 (11) 99999-0000" -> "5511999990000". null se não parecer telefone. */
function normalizarTelefone(texto) {
  const digitos = String(texto ?? '').replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return '55' + digitos; // DDD + número
  if (digitos.length >= 12 && digitos.length <= 15) return digitos;
  return null;
}

/** "5511999990000" -> "+55 11 99999-0000" */
function formatarTelefone(numero) {
  const d = String(numero ?? '');
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : d ? `+${d}` : '';
}

function ehTelefone(c) {
  return c.id.endsWith('@c.us');
}

/** Valida um número no WhatsApp. */
async function contatoPorNumero(client, texto) {
  const numero = normalizarTelefone(texto);
  if (!numero) return { erro: `"${texto}" não é um telefone válido (use DDD + número)` };
  const wid = await comTimeout(client.getNumberId(numero), 30000, 'validar número');
  if (!wid) return { erro: `O número ${formatarTelefone(numero)} não tem WhatsApp` };
  return { contato: { id: wid._serialized, nome: formatarTelefone(wid.user), numero: wid.user } };
}

async function contatoPorNome(client, nome, prefixoPreferido = '55') {
  const alvo = normalizar(nome);
  const candidatos = (await listarContatos(client)).filter((c) => normalizar(c.nome) === alvo);

  const telefones = candidatos.filter(ehTelefone);
  let pool = telefones.length ? telefones : candidatos; // descarta @lid se houver telefone
  const preferidos = pool.filter((c) => ehTelefone(c) && c.numero.startsWith(prefixoPreferido));
  if (preferidos.length) pool = preferidos;

  // Remove duplicados pelo número
  const unicos = [...new Map(pool.map((c) => [c.numero || c.id, c])).values()];

  if (unicos.length === 1) return { contato: unicos[0] };
  if (unicos.length === 0) {
    return { erro: `Contato "${nome}" não encontrado na agenda do WhatsApp`, opcoes: [] };
  }
  return { erro: `Há ${unicos.length} contatos chamados "${nome}"`, opcoes: unicos };
}

/**
 * destino: texto da linha "Enviar para:" (opcional). Pode ser número ou nome.
 * Sem destino, procura pelo nome do cliente.
 */
async function resolverDestino(client, cliente, destino, prefixoPreferido) {
  if (destino) {
    return normalizarTelefone(destino)
      ? contatoPorNumero(client, destino)
      : contatoPorNome(client, destino, prefixoPreferido);
  }
  return contatoPorNome(client, cliente, prefixoPreferido);
}

module.exports = { resolverDestino, contatoPorNumero, normalizarTelefone, formatarTelefone };
