# Atlas Guard Bridge

Extensão Manifest V3 que conecta o painel Atlas Guard ao iframe oficial da Hezilex.

## Instalação de desenvolvimento

1. Abra `edge://extensions` ou `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Selecione **Carregar sem compactação** e escolha esta pasta `extension/`.
4. Abra o painel Atlas Guard.
5. Recarregue o painel. A origem oficial do Atlas é reconhecida e autorizada automaticamente.

Na versão 1.0, a detecção acontece diretamente no painel e a Traderoom é monitorada continuamente. O agente procura o saldo real, bloqueia o início abaixo de R$ 500,00, mantém o padrão de 5 minutos quando os controles são identificados e cria LTA/LTB somente a partir de candles visíveis detectados.

Para instalação sem arquivos locais, a extensão precisa ser publicada na Chrome Web Store ou Microsoft Edge Add-ons e passar pela revisão da loja.

## Limites de segurança da versão 0.1

- Ordens reais de compra e venda estão bloqueadas.
- A extensão não lê valores de campos de login ou senha.
- O Atlas só pode enviar comandos depois que o usuário autorizar explicitamente a origem do painel.
- Marcações são limitadas a oito e linhas com `expiresAt` são removidas automaticamente.
- A configuração de expiração só será alterada após o seletor real ser validado.

