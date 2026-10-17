# Atlas — seu assistente de operação

Produto web com landing page, cadastro, acesso condicionado ao pagamento, painel administrativo e área de mercado com a Hezilex oficial.

## Fluxo do usuário

1. A pessoa cria uma conta com e-mail e senha.
2. O checkout gera uma cobrança PIX pela Venopag.
3. O painel permanece bloqueado enquanto o status for `pending`.
4. Somente `confirmed` libera o Atlas. Estados expirados, cancelados, contestados, estornados ou chargeback retiram o acesso.
5. No painel, o Atlas exibe notícias por impacto e as cinco tendências mais fortes calculadas em velas de 5 minutos.

## Áreas

- `/` — landing page e oferta configurável.
- `/acesso` — login e criação de conta.
- `/recuperar-senha` — recuperação por e-mail.
- `/checkout` — pagamento PIX e acompanhamento da confirmação.
- `/app` — painel Atlas.
- `/admin` — preço, textos, ativos, notícias, Venopag, usuários e senha do administrador.

## Dados de mercado

- Notícias: Google News RSS, com GDELT como segunda fonte.
- Impacto: classificação determinística por termos macroeconômicos e de mercado, identificada na interface como estimativa do Atlas.
- Tendências: Binance Spot pública, EMA9, EMA21, RSI14 e momentum sobre velas de 5 minutos. A análise não executa operações.

## Segurança

- Autenticação e contas no Supabase Auth.
- Dados persistentes no Postgres do Supabase com RLS.
- Credenciais da Venopag criptografadas com AES-256-GCM antes de irem ao banco.
- O navegador nunca recebe Client Secret ou Webhook Secret.
- O webhook valida HMAC e aceita no máximo cinco minutos de diferença.
- Preços e acesso nunca são confiados ao navegador.

## Desenvolvimento

```text
npm install
npm run build
npm test
vercel dev
```

Use `npm run db:setup` somente com as variáveis do Supabase disponíveis e `ATLAS_ADMIN_SEED_PASSWORD` definido apenas no processo de seed.

Produção: https://atlas-guard-trading.vercel.app
