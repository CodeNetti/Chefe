// Projeto Firebase que controla as licenças (passo a passo em FIREBASE.md).
//
// A "apiKey" do Firebase NÃO é senha: ela só identifica o projeto e pode ir no pacote do cliente.
// Quem protege as licenças são as regras do Firestore (firestore.rules): cada usuário só consegue
// LER a própria licença e ninguém consegue alterá-la pelo sistema (só você, pelo console).

module.exports = {
  apiKey: 'AIzaSyDESH6k0EGl6PjD5AnhU1GXdplo000bzZs', // Configurações do projeto > Geral > "Chave de API da Web"
  projectId: 'chefe-a1566', // Configurações do projeto > Geral > "Código do projeto"

  // O assinante entra com USUÁRIO e senha. O Firebase só aceita e-mail, então o sistema usa
  // "usuario@<dominioUsuarios>" por baixo (ex.: joao -> joao@chefe.local). Esse e-mail não existe
  // e nunca recebe nada. Se mudar aqui, mude também em firestore.rules.
  dominioUsuarios: 'chefe.local',
};
