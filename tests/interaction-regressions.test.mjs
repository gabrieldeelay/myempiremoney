import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../dist/modules/app.js", import.meta.url), "utf8");
const bridge = await readFile(new URL("../extension/content-script.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../dist/styles.css", import.meta.url), "utf8");

assert.doesNotMatch(app, /Math\.random\(\)\s*>=\s*\.7/, "o robô não pode ignorar operações aleatoriamente");
assert.match(app, /robot\.commentOnOperation\(state\.manualOperation\)/, "operações devem chegar ao robô");
assert.match(app, /holdMs:\s*8000/, "cada mensagem automática deve permanecer por ao menos oito segundos");
assert.match(app, /this\.queue\.push\(\{ line, context \}\)/, "mensagens consecutivas devem entrar em fila");
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
assert.match(styles, /max-height:\s*calc\(100dvh - 24px\)/, "o balão deve permanecer dentro da altura visível");

console.log("interaction regressions: ok");
