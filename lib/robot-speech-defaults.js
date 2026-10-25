const DEFAULT_ROBOT_SPEECHES = [
  ["waiting", "Enquanto a leitura visual está iniciando e ainda não há dados do gráfico.", "Só um instante. Estou preparando a leitura do gráfico."],
  ["waiting", "Enquanto o Atlas aguarda a primeira imagem válida da corretora.", "Estou esperando a primeira imagem das velas para começar."],
  ["noaccess", "Quando a leitura visual ainda não foi autorizada pelo usuário.", "Ative a leitura visual para eu acompanhar as velas desta aba."],
  ["noaccess", "Quando a corretora está aberta, mas o compartilhamento da tela está desligado.", "A corretora está aberta. Agora só falta você ativar a leitura visual."],
  ["loggedout", "Quando a tela da corretora foi reconhecida, mas a conta ainda não está conectada.", "Faça login na corretora para eu identificar o ativo e iniciar a análise."],
  ["loggedout", "Quando o gráfico não está disponível porque a sessão da corretora está desconectada.", "Ainda não encontrei o gráfico. Entre na sua conta e eu continuo daqui."],
  ["connect", "Quando a leitura visual encontra o gráfico e começa a receber dados.", "Leitura conectada. Já estou acompanhando o mercado ao vivo."],
  ["connect", "Quando o fluxo de imagens volta a funcionar depois de uma interrupção.", "Tudo certo novamente. O gráfico voltou para o meu radar."],
  ["asset", "Quando o usuário muda para um novo ativo reconhecido.", "{asset} identificado. Vou atualizar a leitura antes de indicar qualquer entrada."],
  ["asset", "Quando um ativo diferente passa a ser a aba ativa na corretora.", "Agora estamos em {asset}. Análise anterior descartada e nova leitura iniciada."],
  ["asset", "Quando o ativo é reconhecido depois de alguns instantes de localização.", "Encontrei {asset}. Já estou comparando as velas mais recentes."],
  ["buy", "Quando existe um sinal de compra confirmado pelo indicador.", "Compra confirmada em {asset}, com {confidence}% de confiança. Respeite o momento da entrada."],
  ["buy", "Quando a pressão compradora supera os critérios mínimos do sinal.", "Os compradores ganharam força em {asset}. O sinal atual é de compra."],
  ["buy", "Quando surge uma nova oportunidade de compra durante a leitura.", "Nova oportunidade de compra em {asset}. Confiança atual de {confidence}%."],
  ["buy", "Quando uma compra permanece válida após a atualização da vela.", "A compra continua válida em {asset}. Mantenha a disciplina e não aumente o risco."],
  ["sell", "Quando existe um sinal de venda confirmado pelo indicador.", "Venda confirmada em {asset}, com {confidence}% de confiança. Observe o ponto de entrada."],
  ["sell", "Quando a pressão vendedora supera os critérios mínimos do sinal.", "Os vendedores assumiram o controle em {asset}. O sinal atual é de venda."],
  ["sell", "Quando surge uma nova oportunidade de venda durante a leitura.", "Nova oportunidade de venda em {asset}. Confiança atual de {confidence}%."],
  ["sell", "Quando uma venda permanece válida após a atualização da vela.", "A venda continua válida em {asset}. Evite entrar atrasado e preserve o risco."],
  ["wait", "Quando há dados suficientes, mas nenhuma entrada segura foi confirmada.", "Ainda não há uma entrada segura em {asset}. Continuo acompanhando."],
  ["wait", "Quando compradores e vendedores estão equilibrados e o melhor é esperar.", "O mercado está sem direção clara. Esperar agora também é uma decisão."],
  ["wait", "Quando o movimento existe, mas não possui confirmação técnica para entrada.", "Há movimento, mas ainda falta confirmação. Não transforme pressa em sinal."],
  ["timeframe", "Quando o gráfico não está configurado no período de cinco minutos.", "Coloque o gráfico em cinco minutos para eu analisar as velas corretamente."],
  ["timeframe", "Quando o período do gráfico é ajustado corretamente para cinco minutos.", "Gráfico em cinco minutos confirmado. Agora a leitura está alinhada."],
  ["expiration", "Quando a expiração não está configurada em cinco minutos.", "Ajuste a expiração para cinco minutos antes de considerar uma entrada."],
  ["expiration", "Quando a expiração passa a acompanhar corretamente o gráfico de cinco minutos.", "Expiração em cinco minutos confirmada. Tempo e gráfico estão sincronizados."],
  ["risk", "Quando o sistema calcula o valor recomendado de um por cento da banca.", "O valor de um por cento da sua banca é {amount}. Preserve esse limite."],
  ["risk", "Quando o usuário tenta operar com exposição acima do valor recomendado.", "Sua exposição está acima do planejado. Reduza o valor antes da próxima decisão."],
  ["all", "Quando gráfico, expiração e gerenciamento de risco estão todos corretos.", "Configuração completa: gráfico, expiração e risco estão alinhados."],
  ["all", "Quando todas as verificações iniciais são concluídas com sucesso.", "Tudo pronto. Agora posso concentrar a leitura apenas no mercado."],
  ["reversalBuy", "Quando uma queda extrema encontra suporte e mostra confirmação de recuperação.", "Possível compra em {asset}. A queda perdeu força e apareceu reação compradora."],
  ["reversalBuy", "Quando uma vela vermelha esticada rejeita o fundo com fundamento técnico.", "Atenção para possível reversão de compra em {asset}. Escolha o ponto com calma."],
  ["reversalSell", "Quando uma alta extrema encontra resistência e mostra confirmação de rejeição.", "Possível venda em {asset}. A alta perdeu força e apareceu rejeição no topo."],
  ["reversalSell", "Quando uma vela verde esticada rejeita o topo com fundamento técnico.", "Atenção para possível reversão de venda em {asset}. Aguarde o melhor momento."],
  ["dragged", "Na terceira vez em que o usuário arrasta ou mexe no personagem.", "Ei, eu consigo trabalhar melhor se você me deixar acompanhar o gráfico daqui."],
  ["dragged", "Em novas sequências de três interações com o personagem.", "Tudo bem me mover, mas não esqueça que eu ainda estou analisando o mercado."],
  ["win", "Quando uma operação acompanhada termina com resultado positivo.", "Resultado positivo em {asset}. O mérito está em seguir o plano, não em aumentar a mão."],
  ["loss", "Quando uma operação acompanhada termina com resultado negativo.", "Resultado negativo em {asset}. Nada de revanche: revise a leitura e preserve a banca."],
  ["exposureDanger", "Quando várias operações elevam perigosamente a exposição total da banca.", "Atenção: {count} operações já somam {exposure}. Sua exposição está ficando perigosa."],
  ["protectionReady", "Quando o preço chega à região planejada para uma entrada de proteção.", "A proteção chegou ao ponto em {asset}. Se decidir entrar, mantenha a direção {direction}."],
  ["dragged", "Quando o personagem é movimentado novamente e precisa pedir espaço para continuar a análise.", "O gráfico não vai vir comigo. Escolha um canto e me deixe acompanhar as velas."],
  ["dragged", "Quando o usuário insiste em arrastar o personagem durante a leitura do mercado.", "Eu entendi que você gosta de decoração, mas eu ainda estou tentando analisar o gráfico."],
  ["dragged", "Quando uma nova sequência de movimentos interrompe a posição escolhida para o personagem.", "Pronto, mudei de lugar. Agora me deixa trabalhar antes que a próxima vela feche."],
].map((item, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  context: item[0],
  contextDescription: item[1],
  phrase: item[2],
  active: true
}));

let schemaReady;

async function ensureRobotSpeechSchema(db) {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await db.execute(`CREATE TABLE IF NOT EXISTS robot_speeches (
    id CHAR(36) PRIMARY KEY,
    context_key VARCHAR(64) NOT NULL,
    context_description VARCHAR(255) NOT NULL,
    phrase TEXT NOT NULL,
    audio_path VARCHAR(255) NULL,
    audio_mime VARCHAR(80) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_robot_speeches_context (context_key, active)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    for (const speech of DEFAULT_ROBOT_SPEECHES) {
      await db.execute(
        "INSERT IGNORE INTO robot_speeches (id,context_key,context_description,phrase,active) VALUES (?,?,?,?,1)",
        [speech.id, speech.context, speech.contextDescription, speech.phrase]
      );
    }
  })().catch(error => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

module.exports = { DEFAULT_ROBOT_SPEECHES, ensureRobotSpeechSchema };
