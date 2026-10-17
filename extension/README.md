# Atlas — Assistente de Mercado

Componente Manifest V3 executado silenciosamente no navegador para permitir que o painel Atlas leia o estado da Traderoom oficial, isolada por domínio.

## Escopo da versão 2.5.2

- Lê saldo visível, ativo, timeframe, expiração e velas oficiais.
- Calcula a análise de 5 minutos e cria LTA, LTB e proteção somente pelas ferramentas nativas do gráfico da Hezilex.
- Avisa quando a reentrada de proteção, no mesmo sentido da operação inicial, chega à região planejada.
- Pode configurar gráfico 5M, expiração 5M e valor equivalente a 1% do saldo.
- Não lê campos de login ou senha.
- Não aciona compra, venda ou qualquer outra operação financeira.
- Observa operações manuais e o fechamento de anúncios para alimentar comentários contextuais do robô.
- Verifica atualizações oficiais pelo Edge e exibe versões instalada e pública no popup.
- Localiza o controle de valor por estrutura, botões e contexto, e confirma o 1% no campo nativo atual da Hezilex.
- Abre o menu nativo de desenhos, escolhe “Linha de Tendência” e fixa LTA/LTB entre pivôs recentes.
- Reconhece o painel oficial em nossoatlas.com, www.nossoatlas.com e no endereço anterior da Vercel.
- O serviço de segurança nega toda solicitação de execução financeira, inclusive em contas de teste.

Distribuição pública: Microsoft Edge Add-ons. Durante o desenvolvimento, a pasta `extension/` pode ser carregada em `edge://extensions` com o modo do desenvolvedor ativado.
