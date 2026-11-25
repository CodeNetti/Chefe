# Firebase: login e licença do Domínio do Chefe

A partir da versão 3, o sistema só funciona com um login (**usuário e senha**) cuja licença esteja **liberada** no Firebase.

> **Usuário e senha no sistema, e-mail técnico no Firebase.** O Firebase só faz login por e-mail. Por isso o sistema completa o usuário com `@chefe.local`: o assinante digita `joao` e o sistema entra como `joao@chefe.local`. Esse e-mail não existe e nunca recebe nada. Só você vê esse formato, ao cadastrar o usuário.

- **No Firebase fica só a permissão.** Nenhum pedido, cliente, contato ou mensagem vai para lá.
- **Licença:** documento `licencas/{usuário}` (ex.: `licencas/joao`) com o campo `acesso`:

| `acesso` | Resultado |
|---|---|
| `1` | Liberado |
| `2` | Bloqueado |
| sem documento ou outro valor | Bloqueado |

- **Quando vale:** o login é pedido ao abrir o `iniciar.bat`. Com o sistema rodando, ele reconfere a cada **30 minutos**. Se você mudar para `2`, ele para sozinho em até 30 minutos e não reinicia.
- **Sem internet:** o sistema continua funcionando por até **24 horas** desde a última verificação liberada.

---

## Projeto atual: já configurado ✅

O projeto **Chefe** (`chefe-a1566`) já está pronto. Foi configurado em 25/11/2026 pelo terminal:
- Firestore em São Paulo (`southamerica-east1`) com as regras de [`firestore.rules`](firestore.rules) publicadas;
- login por e-mail/senha ativado, **criação de contas por terceiros bloqueada** e exclusão de conta pelo próprio usuário bloqueada;
- app Web registrado e [`src/firebase-config.js`](src/firebase-config.js) preenchido.

Os passos 1 a 5 abaixo ficam como referência, caso um dia seja preciso montar outro projeto.

## Gerenciar assinantes pelo terminal (recomendado)

O script `scripts/assinantes.js` roda **só no seu computador** e não vai no pacote do cliente. Ele usa o seu login do Google Cloud SDK (`gcloud auth login`, com a conta dona do projeto) como administrador:

```
npm run assinante -- listar
npm run assinante -- novo joao "Mercado do João"    (pede a senha 2x; cria e LIBERA)
npm run assinante -- bloquear joao                   (acesso = 2)
npm run assinante -- liberar joao                    (acesso = 1)
npm run assinante -- senha joao                      (pede a senha nova)
```

A senha é digitada na hora (aparece `*****`) e não fica salva em lugar nenhum. Ao assinante você passa só o **usuário** (`joao`) e a **senha**.

Se o comando disser que não conseguiu o acesso de administrador, faça o login de novo com `gcloud auth login`.

As seções "Cadastrar", "Bloquear" e "Trocar a senha" mais abaixo mostram o jeito manual, pelo console, para quando você não estiver no seu computador.

## Passo a passo (uma vez só)

### 1. Criar o projeto
1. Acesse <https://console.firebase.google.com> com a sua conta Google.
2. **Criar um projeto** → nome, ex.: `dominio-do-chefe` → pode desativar o Google Analytics → **Criar projeto**.

O plano gratuito (Spark) é suficiente.

### 2. Ativar o login por e-mail e senha
1. Menu **Criação → Authentication → Vamos começar**.
2. Aba **Método de login → E-mail/senha → Ativar** (só a primeira chave, não o "link de e-mail") → **Salvar**.
3. Aba **Configurações → Ações do usuário**: **desmarque "Ativar criação (inscrição)"** e salve. Assim **só você cria usuários**. Isso é importante: sem esse bloqueio, alguém poderia criar antes de você um usuário com o nome de um futuro assinante.

### 3. Criar o banco (Firestore)
1. Menu **Criação → Firestore Database → Criar banco de dados**.
2. Local: `southamerica-east1 (São Paulo)`. Não dá para mudar depois.
3. Modo: **produção** → **Criar**.

### 4. Colar as regras de segurança
1. Em **Firestore Database → Regras**, apague o que estiver lá.
2. Cole todo o conteúdo do arquivo [`firestore.rules`](firestore.rules) deste projeto e clique em **Publicar**.

Essas regras deixam cada assinante **ler só a própria licença** e impedem qualquer alteração pelo sistema.

> As regras usam o `@chefe.local`. Se um dia você mudar `dominioUsuarios` em `src/firebase-config.js`, mude nas regras também.

### 5. Pegar a chave do projeto e colar no sistema
1. Clique na engrenagem ⚙️ → **Configurações do projeto → Geral**.
2. Em **Seus apps**, clique no ícone **`</>`** (Web) → apelido `sistema` → **Registrar app** (não precisa do Hosting). Pode fechar a tela de código que aparece.
3. Copie a **Chave de API da Web** (`apiKey`, começa com `AIza...`) e o **Código do projeto** (`projectId`).
4. Abra [`src/firebase-config.js`](src/firebase-config.js) e preencha:

```js
module.exports = {
  apiKey: 'AIza...sua chave...',
  projectId: 'dominio-do-chefe',
};
```

> A `apiKey` do Firebase **não é senha**: ela só identifica o projeto e vai junto no pacote do cliente. Quem protege as licenças são as regras do passo 4.
> **Nunca** coloque no sistema (nem mande para ninguém) a "chave privada da conta de serviço" (arquivo `.json` de *Contas de serviço*). Essa chave dá controle total do projeto.

---

## Cadastrar um assinante

Exemplo: assinante com usuário **`joao`**. Use só letras minúsculas, números, ponto, traço ou sublinhado, sem acento e sem espaço.

1. **Authentication → Usuários → Adicionar usuário**:
   - E-mail: **`joao@chefe.local`**
   - Senha: a senha do assinante (mínimo 6 caracteres)
2. **Firestore Database → Dados → + Iniciar coleção** (só na primeira vez):
   - ID da coleção: `licencas`
   - **ID do documento: `joao`** (o usuário, igual ao que vem antes do `@`; não use o "código automático")
   - Campos:

| Campo | Tipo | Valor |
|---|---|---|
| `acesso` | **number** | `1` |
| `nome` | string | nome do assinante (opcional, só para você se achar) |

   Nos próximos assinantes, entre na coleção `licencas` → **+ Adicionar documento** → ID = usuário.

Ao assinante você passa só: **usuário `joao`** e a **senha**. Na hora do login, maiúsculas e acentos não importam: `João` vale como `joao`.

## Bloquear ou liberar

Em **Firestore Database → licencas → joao**, edite `acesso`:
- `2` → bloqueia (para em até 30 min; ao abrir, nem entra);
- `1` → libera de novo (o assinante abre o `iniciar.bat` e faz login).

> O campo `acesso` precisa ser do tipo **number**. Se for criado como string (`"1"`), o sistema também aceita.

## Trocar a senha de um assinante

Pelo terminal: `npm run assinante -- senha joao`.

Pelo console não dá para digitar uma senha nova, e o "redefinir senha" não funciona, porque o e-mail técnico não recebe mensagens. Pelo console, a saída é:
1. **Authentication → Usuários →** `joao@chefe.local` **→ ⋮ → Excluir conta**.
2. **Adicionar usuário** de novo com o mesmo `joao@chefe.local` e a senha nova.

A licença (`licencas/joao`) continua valendo, porque ela é pelo usuário, não pela conta. Depois de trocar a senha, o sistema do assinante pede login de novo.

## Mensagens que o assinante pode ver

| Mensagem | Causa |
|---|---|
| Usuário ou senha incorretos. | Login errado (3 tentativas por abertura), ou o usuário não foi criado como `usuario@chefe.local` |
| Este usuário não tem licença cadastrada. | Falta o documento `licencas/{usuário}`, ou o ID do documento está diferente do usuário |
| Acesso bloqueado. | `acesso = 2` |
| Sem permissão para ler a licença. | Regras do passo 4 não publicadas |
| Firestore não foi criado no projeto. | Faltou o passo 3 |
| Firebase não configurado em src/firebase-config.js. | Faltou o passo 5 |
| Sem conexão com o servidor de licenças... | Sem internet (vale a tolerância de 24h) |
