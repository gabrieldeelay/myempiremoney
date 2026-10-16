# Atlas — Assistente de Mercado

## Descrição curta

Analisa velas e configura gráfico, expiração e valor de risco na Hezilex, sem executar operações.

## Descrição da loja

O Atlas é um assistente visual para quem acompanha o mercado pela interface web da Hezilex. Ele lê informações técnicas exibidas na aba da plataforma, como ativo, timeframe, expiração, saldo visível e velas, e apresenta uma leitura objetiva no painel Atlas.

Com um clique, os macros podem configurar o gráfico para 5 minutos, a expiração para 5 minutos e o campo de valor para aproximadamente 1% do saldo exibido. O arredondamento respeita os valores aceitos pela própria interface.

A extensão não executa compra, venda ou qualquer outra ordem financeira. Ela também não lê nem armazena login, senha, cartão, PIX ou documento. Preferências e estado técnico ficam no armazenamento local do navegador e não são vendidos ou compartilhados com terceiros.

Recursos principais:

- leitura contínua do ativo e das velas disponibilizadas pela plataforma;
- indicação técnica de compra, venda ou espera, sempre acompanhada dos motivos;
- macros para gráfico 5M, expiração 5M e valor de risco de 1%;
- conexão local com o painel Atlas;
- comentários curtos e contextuais do assistente;
- bloqueio explícito de comandos de execução financeira.

O Atlas não é afiliado à Hezilex e não promete lucro ou resultado. Análises técnicas podem falhar. O usuário continua responsável por revisar a configuração, decidir e executar qualquer operação.

## Categoria sugerida

Produtividade

## Termos de busca

análise técnica, gráfico, velas, timeframe, risco, assistente de mercado

## URLs

- Site: https://atlas-guard-trading.vercel.app/
- Privacidade: https://atlas-guard-trading.vercel.app/privacy
- Suporte: https://atlas-guard-trading.vercel.app/support

## Justificativa das permissões

- `storage`: guardar preferências e o último estado técnico somente no navegador.
- `tabs`: localizar a aba oficial da Hezilex e encaminhar os macros solicitados pelo usuário.
- `https://app.hezilex.com/*`: ler a interface necessária para análise e aplicar os macros de configuração.
- `https://atlas-guard-trading.vercel.app/*`: conectar a extensão ao painel oficial Atlas.

## Instruções para revisão

1. Instale a extensão e abra https://atlas-guard-trading.vercel.app/ no Microsoft Edge.
2. Abra a área pública de login ou uma conta de teste em https://app.hezilex.com/.
3. O painel deve mostrar “Conectado” quando o script da extensão estiver ativo.
4. Após entrar na traderoom, verifique a leitura de ativo, timeframe e expiração.
5. Use os botões “Gráfico 5M”, “Expiração 5M” e “Valor em 1%”. Eles somente alteram os respectivos controles da interface.
6. Confirme que nenhum botão de COMPRA ou VENDA é acionado pela extensão.

## Divulgação de dados

A extensão processa localmente informações financeiras visíveis (saldo exibido e valor configurado) e atividade técnica da página (ativo, candles, timeframe e expiração) exclusivamente para entregar a funcionalidade solicitada. Esses dados não são vendidos, usados para publicidade, enviados ao desenvolvedor ou compartilhados com terceiros.
