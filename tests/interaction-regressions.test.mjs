import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeAssetName } from "../dist/modules/asset-name.js";

const app = await readFile(new URL("../dist/modules/app.js", import.meta.url), "utf8");
const bridge = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");
const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");

assert.equal(normalizeAssetName("ETHUSDT"), "ETHEREUM");
assert.equal(normalizeAssetName("sol/usdt"), "SOLANA");
assert.equal(normalizeAssetName("Bitcoin Crypto"), "BITCOIN");
assert.equal(normalizeAssetName("cadjpy"), "CAD/JPY");
assert.equal(normalizeAssetName("EUR/USD"), "EUR/USD");

assert.doesNotMatch(app, /Math\.random\(\)\s*>=\s*\.7/, "o robô não pode ignorar operações aleatoriamente");
assert.match(app, /robot\.commentOnOperation\(state\.manualOperation\)/, "operações devem chegar ao robô");
assert.match(app, /holdMs:\s*8000/, "cada mensagem automática deve permanecer por ao menos oito segundos");
assert.match(app, /this\.queue = \[\{ line, context \}\]/, "a fila deve manter apenas o comentário mais recente");
assert.match(app, /if \(interrupt\) this\.queue = \[\]/, "ações prioritárias devem descartar comentários antigos");
assert.match(app, /atlas-robot-variants-v2/, "a seleção deve lembrar moldes já usados, não apenas o texto interpolado");
assert.match(app, /if \(context === "loggedout"\) return !marketReady\(\)/, "falas de logout devem ser invalidadas assim que a conta for identificada");
assert.match(app, /this\.queue = this\.queue\.filter\(item => this\.contextStillValid\(item\.context\)\)/, "a fila deve descartar mensagens incompatíveis com o estado atual");
assert.match(app, /robot\.speak\("connect", \{\}, true, true\)/, "o aviso de conta conectada deve substituir imediatamente uma fala antiga");
assert.match(app, /robot\.speak\("noaccess"\);/, "a verificação rápida de conexão não pode atropelar a fala atual");
assert.match(bridge, /detectManualOperationClick\(event\)/, "cliques de compra e venda devem ser observados imediatamente");
assert.match(bridge, /Compra manual detectada/, "compras precisam gerar um evento explícito");
assert.match(bridge, /Venda manual detectada/, "vendas precisam gerar um evento explícito");
assert.match(bridge, /lastHistoryCheckAt < 1500/, "a confirmação pelo histórico precisa ser rápida");
assert.match(bridge, /new view\.MouseEvent\("mousedown"/, "o seletor M5 deve reproduzir a ativação completa do controle");
assert.match(bridge, /waitFor\(timeframeIsFive, 1500/, "o macro M5 deve aguardar a confirmação visual");
assert.match(app, /new ResizeObserver\(\(\) => requestAnimationFrame\(keepRobotInViewport\)\)/, "o robô deve ser reposicionado quando o balão mudar de tamanho");
assert.match(app, /characterBefore\.left - characterAfter\.left/, "minimizar deve preservar a posição visual do personagem");
assert.match(styles, /max-height:\s*calc\(100dvh - 24px\)/, "o balão deve permanecer dentro da altura visível");
assert.match(app, /robotLine"\)\.innerHTML = formatRobotMessage/, "o balão deve aceitar ênfase segura em negrito e itálico");
assert.match(app, /createOscillator\(\)/, "o robô deve emitir um som local suave");
assert.doesNotMatch(app, /42000/, "o robô não deve falar periodicamente sem motivo");
assert.doesNotMatch(app, /state\.asset && state\.asset !== previousAsset\) robot\.speak/, "trocar de ativo não deve gerar narração automática");
assert.match(styles, /--bg:\s*#030a16/, "o painel deve usar o novo tema azul-escuro");
assert.match(styles, /\.robot-head[^\n]+background:\s*linear-gradient\(145deg, #ffffff, #dce8f7\)/, "o personagem deve usar o tema branco");
assert.match(styles, /\.cursor-glow/, "o fundo deve ter iluminação suave que acompanha o ponteiro");
assert.match(html, /data-settings-trigger/, "a instalação deve ficar dentro de Configurações");
assert.doesNotMatch(html, /Abrir em nova aba|app\.hezilex\.com<\/code>/, "o topo não deve exibir ações e endereço desnecessários");

console.log("interaction regressions: ok");
