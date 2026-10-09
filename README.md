# Atlas Guard + Browser Bridge

Painel responsivo que incorpora a página oficial da Hezilex e se comunica com uma extensão Manifest V3 executada dentro de `app.hezilex.com`.

## Segurança e escopo

- A interface carregada no painel vem diretamente de `https://app.hezilex.com`.
- Login, saldo e ordens de compra e venda são processados pela própria Hezilex dentro do iframe.
- O Atlas Guard não lê, transmite ou armazena credenciais.
- A extensão não lê, transmite nem armazena campos de senha.
- O painel precisa ser autorizado uma vez no popup da extensão antes de poder enviar comandos.
- A versão atual detecta a Traderoom, mantém estado, respeita atividade manual, aplica o timeframe de 5 minutos somente quando o alvo é inequívoco, exibe a análise dentro da Hezilex e desenha até oito marcações controladas.
- A expiração de 5 minutos é verificada, mas não é alterada enquanto o seletor exato não estiver validado.
- Compra e venda automáticas continuam bloqueadas até validar os seletores reais, a leitura de candles/resultados e os limites de risco. Nenhum sinal aleatório é produzido.
- Caso o navegador bloqueie cookies de terceiros, o painel oferece acesso direto à plataforma oficial em uma nova aba.

Abra `dist/index.html` por um servidor HTTP local. O projeto não possui dependências externas.

## Extensão

O código está em `extension/`. Para desenvolvimento, abra `chrome://extensions` ou `edge://extensions`, ative o modo de desenvolvedor e carregue essa pasta sem compactação. Depois abra o Atlas Guard, clique no ícone **Atlas Guard Bridge**, autorize o endereço do painel e recarregue.

Para não exigir instalação manual, o pacote precisa ser publicado na Chrome Web Store ou no Microsoft Edge Add-ons. Essa etapa depende de uma conta de publicador e da revisão da loja.

## Publicação na Vercel

O projeto inclui `vercel.json` e publica diretamente o conteúdo estático de `dist/`, sem etapa de instalação ou compilação.

Produção: https://atlas-guard-trading.vercel.app

> A hospedagem na Vercel não concede ao site acesso direto ao DOM interno de `app.hezilex.com`. Esse acesso é fornecido exclusivamente pelo script autorizado da extensão, limitado ao domínio da Hezilex.

