# Atlas Guard Bridge

Extensão Manifest V3 que conecta o painel Atlas Guard ao iframe oficial da Hezilex.

## Instalação de desenvolvimento

1. Abra `edge://extensions` ou `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Selecione **Carregar sem compactação** e escolha esta pasta `extension/`.
4. Abra o painel Atlas Guard.
5. Recarregue o painel. A origem oficial do Atlas é reconhecida e autorizada automaticamente.

Na versão 1.1, a detecção acontece diretamente no painel e a Traderoom é monitorada continuamente. O agente procura o saldo, bloqueia o início abaixo de R$ 500,00, mantém velas e expiração em 5 minutos e cria LTA/LTB a partir do feed OHLC oficial.

Para instalação sem arquivos locais, a extensão precisa ser publicada na Chrome Web Store ou Microsoft Edge Add-ons e passar pela revisão da loja.

## Limites de segurança da versão 1.1

- Ordens automáticas são permitidas somente quando a **Conta Demo** foi confirmada duas vezes; a Conta Principal fica bloqueada.
- A extensão não lê valores de campos de login ou senha.
- O Atlas só pode enviar comandos depois que o usuário autorizar explicitamente a origem do painel.
- Marcações são limitadas a cinco e linhas de proteção expiram automaticamente.
- Entrada-base em 1% do saldo, proteção em 2x e no máximo dois níveis.
