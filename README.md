# Atlas Guard + Browser Bridge

Painel responsivo que incorpora a página oficial da Hezilex e se comunica com uma extensão Manifest V3 executada dentro de `app.hezilex.com`.

## Segurança e escopo

- A interface carregada no painel vem diretamente de `https://app.hezilex.com`.
- Login, saldo e ordens de compra e venda são processados pela própria Hezilex dentro do iframe.
- O Atlas Guard não lê, transmite ou armazena credenciais.
- Login salvo deve usar o gerenciador de senhas do Chrome/Edge na página oficial da Hezilex; o painel nunca mantém uma cópia da senha.
- A extensão não lê, transmite nem armazena campos de senha.
- O painel precisa ser autorizado uma vez no popup da extensão antes de poder enviar comandos.
- A versão atual detecta a Traderoom, mantém estado, respeita atividade manual, aplica timeframe e expiração de 5 minutos, exibe a análise dentro da Hezilex e desenha somente as LTA/LTB relevantes.
- A análise usa o feed oficial OHLC de 5 minutos da própria Traderoom; nenhum sinal aleatório é produzido.
- Compra e venda automáticas são permitidas exclusivamente na **Conta Demo verificada**. A Conta Principal é bloqueada antes de qualquer clique financeiro.
- A entrada-base é 1% do saldo. Depois de uma perda confirmada, a proteção usa 2x por nível e nunca ultrapassa dois níveis.
- Uma vela fechada com amplitude acima de 2,35 vezes a média das 20 anteriores ativa a proteção de volatilidade, bloqueia a entrada e desenha uma linha temporária.
- Caso o navegador bloqueie cookies de terceiros, o painel oferece acesso direto à plataforma oficial em uma nova aba.

Abra `dist/index.html` por um servidor HTTP local. O projeto não possui dependências externas.

## Extensão

O painel oferece um endereço estável para download e verifica silenciosamente a conexão a cada 4 segundos. A versão 1.1 usa um canal direto com o domínio oficial do Atlas, mantém histórico local recolhível, monitora saldo e ativo, aplica 5m/5m e só cria LTA/LTB quando encontra pivôs válidos no feed oficial. A extensão é opcional: sem ela, o acesso manual à Hezilex continua disponível.

O código está em `extension/`. Para desenvolvimento, abra `chrome://extensions` ou `edge://extensions`, ative o modo de desenvolvedor e carregue essa pasta sem compactação. Depois abra o Atlas Guard, clique no ícone **Atlas Guard Bridge**, autorize o endereço do painel e recarregue.

O site usa o endereço estável `/downloads/atlas-guard-bridge.zip`, evitando links diferentes a cada publicação.

Para não exigir instalação manual, o pacote precisa ser publicado na Chrome Web Store ou no Microsoft Edge Add-ons. Essa etapa depende de uma conta de publicador e da revisão da loja.

## Publicação na Vercel

O projeto inclui `vercel.json` e publica diretamente o conteúdo estático de `dist/`, sem etapa de instalação ou compilação.

Produção: https://atlas-guard-trading.vercel.app

> A hospedagem na Vercel não concede ao site acesso direto ao DOM interno de `app.hezilex.com`. Esse acesso é fornecido exclusivamente pelo script autorizado da extensão, limitado ao domínio da Hezilex.
