// Consultas "leves" ao WhatsApp Web.
//
// Por que existe: client.getChats() e client.getContacts() da whatsapp-web.js montam
// o modelo completo de TODAS as conversas/contatos e, para grupos e contas Business,
// fazem chamadas de rede ao servidor. Se uma única chamada trava, a função inteira
// nunca retorna (foi o que travou o sistema no primeiro teste).
// Aqui lemos só o que precisamos direto da memória da página, sem rede.

/** Rejeita a promessa se ela demorar mais que `ms`. */
function comTimeout(promessa, ms, rotulo) {
  let timer;
  const limite = new Promise((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new Error(`Tempo esgotado (${ms / 1000}s) em: ${rotulo}`)), ms);
  });
  return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

/** [{ id, nome }] de todos os grupos carregados. */
async function listarGrupos(client) {
  return comTimeout(
    client.pupPage.evaluate(() =>
      window
        .require('WAWebCollections')
        .Chat.getModelsArray()
        .filter((c) => c.id && c.id.server === 'g.us')
        .map((c) => ({ id: c.id._serialized, nome: c.formattedTitle || c.name || '' }))
    ),
    30000,
    'listar grupos'
  );
}

/** [{ id, nome, pushname, numero }] dos contatos salvos na agenda. */
async function listarContatos(client) {
  return comTimeout(
    client.pupPage.evaluate(() => {
      const lista = [];
      for (const contato of window.require('WAWebCollections').Contact.getModelsArray()) {
        try {
          const m = window.WWebJS.getContactModel(contato); // síncrono, sem rede
          if (!m.isMyContact || !m.isUser || m.isGroup || m.isMe) continue;
          lista.push({
            id: m.id && m.id._serialized ? m.id._serialized : String(m.id),
            nome: m.name || '',
            pushname: m.pushname || '',
            numero: m.userid || (m.id && m.id.user) || '',
          });
        } catch (e) {
          /* contato com dados incompletos: ignora */
        }
      }
      return lista;
    }),
    30000,
    'listar contatos'
  );
}

module.exports = { comTimeout, listarGrupos, listarContatos };
