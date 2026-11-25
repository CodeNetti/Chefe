# Domínio do Chefe

Confere automaticamente os pedidos postados em um grupo do WhatsApp contra a planilha de produtos e encaminha ao cliente.

## ⬇️ Download (para usar o sistema)

1. Vá em **[Releases](../../releases/latest)** e baixe o arquivo **`DominioDoChefe.zip`**. Ele já traz tudo, e não precisa instalar nada.
2. Extraia a pasta em um lugar fixo do computador (ex.: Documentos).
3. Abra o **`iniciar.bat`**, entre com **usuário e senha** da assinatura, digite a sua chave Pix e escaneie o QR Code com o WhatsApp.

> O botão verde **Code → Download ZIP** baixa só o código-fonte, sem o Node e o Chrome. Para usar o sistema, baixe pelo **Releases**.

## Login e assinatura (Firebase)

Desde a versão 3, o sistema só roda com **usuário e senha** de uma assinatura **liberada** no Firebase. Configuração, cadastro de assinantes e bloqueio estão em **[FIREBASE.md](FIREBASE.md)**.

- **No Firebase fica só a permissão:** `licencas/{usuario}` com `acesso = 1` (liberado) ou `2` (bloqueado). Nenhum dado de pedido ou cliente vai para lá.
- **Ao abrir o `iniciar.bat`:** pede usuário e senha (a senha aparece como `*****`). Nas reinicializações automáticas, não pede de novo: usa a sessão salva em `estado/licenca.json`, que guarda um token do Firebase e nunca a senha.
- **Com o sistema rodando:** a licença é conferida a cada 30 minutos. Se estiver bloqueada, o sistema para e o `iniciar.bat` não reinicia.
- **Sem internet:** o sistema continua por até 24h desde a última verificação liberada.

## Como funciona

1. O sistema fica conectado ao WhatsApp, monitorando **um grupo** (`grupo` no `config.json`).
2. Toda mensagem do grupo que começa com `Cliente:` é tratada como pedido.
3. Cada item é conferido pelo **COD** na planilha: `quantidade × preço = valor da linha`. Se houver linha `Total`, a soma também é conferida.
4. Resultado:
   - **Tudo certo:** reage ✅ na mensagem, envia o pedido ao contato do cliente (só com o nome dos produtos, sem os códigos) e posta uma cópia de controle no grupo.
   - **Divergência:** reage ❌ e responde no grupo com o que está errado. **Não envia ao cliente.**
   - **Conferido, mas sem destinatário definido** (contato não encontrado, ou dois com o mesmo nome): reage ❓ e pergunta no grupo para quem enviar (veja abaixo).

## Para quem o pedido é enviado

- **Padrão:** o contato da agenda com o nome da linha `Cliente:`.
  - Se o mesmo nome aparecer com um telefone e com um ID interno do WhatsApp (ex.: `10000000000001`), o telefone sempre vence.
  - Entre telefones, vence o que começa com `prefixoPreferido` (padrão `55`).
- **Forçar o destino no pedido:** adicione uma linha `Enviar para: 11999990000` (telefone) ou `Enviar para: Nome do Contato`.
- **Escolher no grupo:** quando o sistema não consegue decidir, ele posta as opções numeradas. **Responda essa mensagem** com:
  - o número da opção (`1`, `2`...);
  - ou um telefone com DDD;
  - ou `0` para cancelar.

  Se só houver uma pergunta aberta, não precisa citar. As perguntas abertas ficam só na memória: se o sistema reiniciar, poste o pedido de novo.

## Formato da mensagem no grupo

```
Cliente: Gustavo
Pedido
2x - Alface - COD:2121 - R$80,00
3x - Tomate - COD:1010 - R$22,50
Total: R$102,50
```

- **1ª linha:** `Cliente:` seguido do nome **exatamente como está salvo na agenda** do WhatsApp (acentos e maiúsculas não importam).
- **Valor de cada item:** é o total da linha (quantidade × preço unitário).
- **Opcionais:** o nome do produto no item (a conferência usa só o COD), a linha `Pedido`, a linha `Entrega: ...`, a linha `Frete: R$...` e a linha `Total`.
- **Frete:** com a linha `Frete: R$70,00`, o Total precisa ser itens + frete, e o frete aparece na mensagem ao cliente.
- **Quantidade:** aceita qualquer unidade (`2x`, `5g`, `10m`, `1,5kg`, `3`). A conta usa só o número; a unidade aparece na mensagem ao cliente (`5g Queijo — R$ ...`).

## Grupo Tratamento de Texto (pedidos bagunçados)

Cole no grupo **Tratamento de Texto** (`grupoTratamento` no `config.json`) o pedido do jeito que veio. O sistema monta o pedido no formato acima e **posta sozinho no grupo de pedidos**, onde ele é conferido normalmente.

Exemplos que ele entende:

```
SUMMARY XKTP              Alias: Person1          10g ItemD - 270,00
1g ItemA - 75             Order:                  3g ItemB - 219,00
8g ItemB - 70             1g ItemF                Total R$ 708,00
5g ItemE                  Total: 25$              Person3
total : 75+560+115=750                            Station Place1
pickup/station
```

- **Cliente:** `Vulgo: X`, `Alias: X`, `Cliente: X`, `Resumo X`, `Summary X`, o rótulo sozinho com o nome na linha de baixo (`VULGO` / `Kelvão`), um nome sozinho numa linha, ou `... para X` no fim de cada item (um cliente por linha). Saudações (`Salve chefe bom dia!!`), `Pix` e emojis são ignorados.
- **Itens:** quantidade + produto + valor opcional, com a quantidade antes ou depois do nome (`10g Produto X` ou `Produto X 10g`). O produto é achado pelo nome da planilha (aceita plural, erro de digitação e a coluna **Apelidos**) ou pelo COD.
- **Sem quantidade:** `Alface = R$40,00` vira `1x Alface` (valor ÷ preço da planilha).
- **Valor ao lado do item:** pode ser o preço por unidade ou o total da linha (separado por `-`, `=`, `:`, `>>>>`...); o sistema escolhe o que fecha com o Total.
- **Tudo numa linha:** `Vulgo cond$  10g Produto X.  Total R$ 750,00` é separado em cliente, item e total.
- **Entrega:** `Entrega: X`, `FORMA DE ENTREGA Lapa` e linhas com `station`, `delivery`, `retirada`, `pickup`... viram `Entrega:` no pedido.
- **Frete:** `Motoca = 70,00`, `Frete: R$ 20,00` ou `FRETE: Motoca (Rua X)`. Com valor, vira a linha `Frete:` e entra no Total. `total R$ 2.925,00 + frete` é lido como o total sem o frete.
- **Colagem de várias mensagens** (`[21:37, 24/11/2026] Fulano: ...`) vira um pedido por mensagem.
- **Quando não entende** (produto desconhecido ou ambíguo, cliente faltando), pergunta no próprio grupo. **Responda citando a pergunta** (com uma só aberta, não precisa citar). `0` tira o item ou cancela o pedido.
- **Aprende:** quando você diz qual produto era uma palavra desconhecida, ela vira apelido (`estado/apelidos.json`) e não é perguntada de novo.

## Planilha de produtos

O arquivo é `produtos.xlsx`, com as colunas **COD**, **Nome** e **Preço** na primeira aba. Pode ser editado com o sistema rodando, porque ele recarrega o arquivo sozinho quando há alteração.

Colunas opcionais:

| Coluna | Para que serve |
|---|---|
| **A partir de** | Faixas de preço. Cada faixa é uma linha com o **mesmo Nome** e COD próprio. Aceita um número (`50` = a partir de 50) ou a faixa escrita: `<50 g`, `≥50 e <100 g`, `50 a 99`, `até 49`, `50+`. Ex.: `4010 · Produto X · <50 g · 75` e `4020 · Produto X · ≥50 e <100 g · 70` → até 49g usa 4010, de 50g a 99g usa 4020, e 100g ou mais fica fora das faixas (erro). A unidade escrita é só informativa: vale o número. Na conferência, COD da faixa errada é apontado como erro. |
| **Apelidos** | Outros nomes do produto, separados por vírgula, usados no grupo Tratamento de Texto. |

Para gerar uma planilha de exemplo, use `npm run exemplo`.

## Instalação e uso

```
npm install
iniciar.bat
```

1. Ao abrir, aparece a tela "CHEFE", o login (usuário e senha, veja [FIREBASE.md](FIREBASE.md)) e a pergunta da chave Pix (ENTER mantém a atual). A resposta fica salva no `config.json`. Essa pergunta só aparece quando o `iniciar.bat` é aberto, não nas reinicializações automáticas.
1. Na primeira vez, aparece um QR Code no terminal. No celular, abra **WhatsApp > Aparelhos conectados > Conectar aparelho** e escaneie. A sessão fica salva em `.sessao/`.
2. O `iniciar.bat` reinicia o sistema automaticamente se ele cair ou se o WhatsApp desconectar.
3. Os pedidos que chegarem com o sistema desligado são conferidos quando ele voltar. A busca vai até as últimas `historicoAoIniciar` mensagens.
4. Na **primeira** execução, as mensagens antigas do grupo são ignoradas.

## config.json

| Campo | Para que serve |
|---|---|
| `grupo` | Nome do grupo de pedidos (formato certo, conferência). |
| `grupoTratamento` | Nome do grupo onde se colam pedidos bagunçados. Vazio = desligado. |
| `planilhaProdutos` | Caminho da planilha. |
| `exigirTotal` | `true` faz a linha `Total` ser obrigatória. |
| `toleranciaCentavos` | Diferença aceita por arredondamento. `0` = exato. |
| `historicoAoIniciar` | Quantas mensagens recentes reverificar ao ligar. |
| `prefixoPreferido` | Prefixo de telefone priorizado quando há contatos com o mesmo nome (padrão `55`). |
| `debug` | `true` mostra no terminal cada mensagem que chega no grupo. |
| `mostrarNavegador` | `true` mostra a janela do Chrome, útil para depurar. |
| `chromePath` | Caminho de um Chrome instalado. Se ficar vazio, usa o Chrome que vem com o sistema. |
| `chavePix` | Chave Pix para recebimento, inserida em `{pix}`. |
| `mensagemCliente` | Modelo da mensagem enviada ao cliente. Aceita `{cliente}`, `{itens}`, `{total}`, `{frete}` e `{pix}`. O frete, quando houver, já aparece no fim de `{itens}`. |
| `modeloItem` | Modelo de cada item. Aceita `{qtd}` (já com a unidade: `2x`, `5g`), `{nome}`, `{unitario}` e `{valor}`. |

## Relatório

Cada conferência fica registrada em `resultados/conferencias_AAAA-MM.csv`, que abre direto no Excel. O status de cada linha é um destes: `OK`, `ERRO`, `NAO_ENVIADO` ou `FALHA`.

## Entregar ao cliente (pacote portátil)

```
npm run empacotar
```

Gera `dist/DominioDoChefe.zip`, que já leva o Node (`runtime/`) e o Chrome (`chrome/`). O cliente só precisa extrair e abrir o `iniciar.bat`. O pacote **não** leva a sua sessão do WhatsApp (`.sessao/`), nem `estado/` e `resultados/`, e vai com a chave Pix vazia, para o cliente digitar a dele. O `empacotar` se recusa a gerar o pacote se `src/firebase-config.js` não estiver preenchido.

A `whatsapp-web.js` está instalada direto do GitHub (commit `38eb45b`, correção #201990), porque a versão 1.34.8 do npm não gera QR Code desde a mudança do WhatsApp Web de 23/11/2026. Quando sair uma versão nova no npm com essa correção, dá para voltar a instalar pelo npm.

## Testes

```
npm test
```
