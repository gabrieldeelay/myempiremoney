# Atlas — Assistente de Mercado

Componente Manifest V3 executado silenciosamente no navegador para permitir que o painel Atlas leia o estado da Traderoom oficial, isolada por domínio.

## Escopo da versão 2.4.0

- Lê saldo visível, ativo, timeframe, expiração e velas oficiais.
- Calcula a análise de 5 minutos e mantém no máximo cinco marcações relevantes.
- Pode configurar gráfico 5M, expiração 5M e valor equivalente a 1% do saldo.
- Não lê campos de login ou senha.
- Não aciona compra, venda ou qualquer outra operação financeira.
- Observa operações manuais e o fechamento de anúncios para alimentar comentários contextuais do robô.
- Verifica atualizações oficiais pelo Edge e exibe versões instalada e pública no popup.
- O serviço de segurança nega toda solicitação de execução financeira, inclusive em contas de teste.

Distribuição pública: Microsoft Edge Add-ons. Durante o desenvolvimento, a pasta `extension/` pode ser carregada em `edge://extensions` com o modo do desenvolvedor ativado.
