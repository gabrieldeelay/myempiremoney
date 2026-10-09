# Atlas Guard Bridge

Extensão Manifest V3 que conecta o painel Atlas Guard ao iframe oficial da Hezilex.

## Instalação de desenvolvimento

1. Abra `edge://extensions` ou `chrome://extensions`.
2. Ative **Modo do desenvolvedor**.
3. Selecione **Carregar sem compactação** e escolha esta pasta `extension/`.
4. Abra o painel Atlas Guard.
5. Clique no ícone da extensão e selecione **Autorizar este painel**.
6. Recarregue o painel.

Para instalação sem arquivos locais, a extensão precisa ser publicada na Chrome Web Store ou Microsoft Edge Add-ons e passar pela revisão da loja.

## Limites de segurança da versão 0.1

- Ordens reais de compra e venda estão bloqueadas.
- A extensão não lê valores de campos de login ou senha.
- O Atlas só pode enviar comandos depois que o usuário autorizar explicitamente a origem do painel.
- Marcações são limitadas a oito e linhas com `expiresAt` são removidas automaticamente.
- A configuração de expiração só será alterada após o seletor real ser validado.

