# Atlas — assistente de mercado

Interface minimalista em tema escuro e laranja que mantém a Hezilex oficial dentro do painel e apresenta uma leitura técnica contínua das velas de 5 minutos.

## Comportamento

- A análise é atualizada automaticamente ao entrar na Traderoom e ao trocar de ativo.
- Os sinais `COMPRA`, `VENDA` e `AGUARDAR` vêm do feed OHLC oficial de 5 minutos; não existem sinais aleatórios.
- LTA, LTB e a proteção contra picos são calculadas com velas fechadas.
- Os únicos comandos disponíveis ajustam gráfico para 5M, expiração para 5M e o campo de valor para 1% do saldo visível.
- O Atlas nunca aciona os botões de compra ou venda. A execução é sempre manual.
- O mascote minimizável comenta ativo, sinal e configurações com frases curtas, contextuais e sem repetição imediata.

## Login e privacidade

O conteúdo de login e negociação vem diretamente de `https://app.hezilex.com`. O Atlas não lê nem armazena campos de senha. Para permanecer conectado, use a sessão oficial da Hezilex e o gerenciador de senhas do Chrome ou Edge.

O componente local em `extension/` funciona silenciosamente como ponte entre dois domínios isolados pelo navegador. Ele não aparece na interface, não possui permissão de execução financeira e nega qualquer pedido de ordem.

## Publicação

O projeto inclui `vercel.json` e publica o conteúdo estático de `dist/`.

O instalador em `/install` consulta `/api/extension-status` para detectar automaticamente quando a versão da Microsoft Edge Add-ons estiver disponível. O painel abre apenas a confirmação oficial em uma janela separada, continua aberto e reconhece a extensão assim que ela responde.


Produção: https://atlas-guard-trading.vercel.app
