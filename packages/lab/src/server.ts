import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { bench, readRun } from "./runner.js";
import type { EvalJudgment, SearchConfigWithBench, ServeLabOptions } from "./types.js";

export interface LabServer {
  url: string;
  close(): Promise<void>;
}

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Seekite lab</title>
  <style>
    :root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#0b1020;color:#eef2ff}*{box-sizing:border-box}body{margin:0}button,input,select,textarea{font:inherit}.shell{display:grid;grid-template-columns:18rem 1fr;min-height:100vh}.side{padding:1.25rem;border-right:1px solid #28324d;background:#10172a}.main{padding:2rem;overflow:auto}.brand{font-size:1.25rem;font-weight:750;margin:0 0 1.5rem}.muted{color:#9aa7c2}.runs{display:grid;gap:.5rem}.run{width:100%;text-align:left;padding:.75rem;border:1px solid #34405f;border-radius:.55rem;background:#151f36;color:inherit;cursor:pointer}.run[aria-current=true]{border-color:#7c9cff;background:#1d2b4d}.toolbar{display:flex;gap:.75rem;align-items:end;flex-wrap:wrap;margin-bottom:1.5rem}.toolbar input[type=search]{padding:.65rem .8rem;border:1px solid #34405f;border-radius:.5rem;background:#10172a;color:inherit}.candidate-picks{display:flex;gap:.65rem;flex-wrap:wrap;padding:.5rem .75rem;border:1px solid #34405f;border-radius:.5rem}.candidate-picks legend{padding:0 .25rem}.primary{padding:.65rem .9rem;border:0;border-radius:.5rem;background:#6e8cff;color:#081022;font-weight:700;cursor:pointer}.card{padding:1rem;border:1px solid #28324d;border-radius:.75rem;background:#111a30}.queries{display:grid;gap:1rem;margin-top:1.5rem}.query-heading{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}.judgment{min-width:18rem;flex:1;padding:.5rem .65rem;border:1px solid #34405f;border-radius:.4rem;background:#10172a;color:inherit}.compare-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(17rem,1fr));gap:.75rem;margin-top:.75rem}.candidate-card{padding:.75rem;border:1px solid #34405f;border-radius:.55rem;background:#0f182d}.candidate-card h4{margin:.1rem 0 .65rem}.hit{display:block;padding:.65rem 0;border-top:1px solid #28324d}.hit-row{display:flex;gap:.5rem;align-items:start}.relevant{color:#8ce6ae}.score{font-variant-numeric:tabular-nums;color:#9aa7c2}.breakdown{font-size:.82rem}.miss{color:#ff9c9c;margin-top:.5rem}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:.65rem;border-bottom:1px solid #28324d}.error{color:#ff9c9c}.empty{padding:3rem;text-align:center;color:#9aa7c2}@media(max-width:760px){.shell{grid-template-columns:1fr}.side{border-right:0;border-bottom:1px solid #28324d}.main{padding:1rem}}
  </style>
</head>
<body>
<div class="shell"><aside class="side"><h1 class="brand">Seekite lab</h1><button id="bench" class="primary">Run benchmark</button><p class="muted" id="status">Local only · no telemetry</p><div class="runs" id="runs"></div></aside><main class="main"><div id="app" class="empty">Choose a run to inspect.</div></main></div>
<script type="module">
const runsEl=document.querySelector('#runs'),app=document.querySelector('#app'),status=document.querySelector('#status');let current;
const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=(v)=>Number(v??0).toFixed(3);
async function refresh(){const response=await fetch('/api/runs');const runs=await response.json();runsEl.innerHTML='';for(const item of runs){const button=document.createElement('button');button.className='run';button.textContent=item.label+' · '+new Date(item.createdAt).toLocaleString();button.setAttribute('aria-current',String(current?.file===item.file));button.onclick=()=>load(item.file);runsEl.append(button)}if(!current&&runs[0])load(runs[0].file)}
async function load(file){const response=await fetch('/api/runs/'+encodeURIComponent(file));const run=await response.json();current={file,run,judgments:run.perQuery.map(row=>({query:row.query,relevant:[...row.relevant]}))};render();refresh()}
function render(){const run=current.run,names=Object.keys(run.candidates);app.innerHTML='<div class="toolbar"><fieldset class="candidate-picks"><legend>Compare candidates</legend>'+names.map(name=>'<label><input class="candidate" type="checkbox" value="'+esc(name)+'" checked> '+esc(name)+'</label>').join('')+'</fieldset><label>Find eval <input id="query" type="search" placeholder="Filter queries"></label><label>Semantic blend <input id="weight" type="range" min="0" max="1" step=".05" value=".5"></label><button id="save" class="primary">Save judgments</button></div><section id="matrix"></section><section class="queries" id="queries"></section>';const candidates=[...app.querySelectorAll('.candidate')],query=app.querySelector('#query'),weight=app.querySelector('#weight');const selected=()=>candidates.filter(input=>input.checked).map(input=>input.value);const draw=()=>{drawMatrix(run);drawQueries(run,selected(),query.value,Number(weight.value))};for(const input of candidates){input.onchange=()=>{if(selected().length<Math.min(2,names.length)){input.checked=true;status.textContent=names.length>1?'Choose at least two candidates to compare.':'Choose the candidate to inspect.';return}draw()}}query.oninput=draw;weight.oninput=draw;app.querySelector('#save').onclick=saveJudgments;draw()}
function drawMatrix(run){const rows=[];for(const [name,value] of Object.entries(run.candidates)){for(const [mode,q] of Object.entries(value.quality)){rows.push('<tr><td>'+esc(name)+'</td><td>'+esc(mode)+'</td><td>'+number(q.recall)+'</td><td>'+number(q.mrr)+'</td><td>'+number(q.ndcg)+'</td><td>'+number(value.query.p50ms)+'</td><td>'+Math.round(value.artifacts.totalBytes/1024)+' KiB</td></tr>')}}app.querySelector('#matrix').innerHTML='<div class="card"><h2>Candidate matrix</h2><table><thead><tr><th>Candidate</th><th>Mode</th><th>Recall</th><th>MRR</th><th>NDCG</th><th>p50 ms</th><th>Size</th></tr></thead><tbody>'+rows.join('')+'</tbody></table></div>'}
function drawQueries(run,names,filter,weight){const needle=filter.toLocaleLowerCase();const rows=run.perQuery.map((row,index)=>({row,index,judgment:current.judgments[index]})).filter(item=>item.judgment.query.toLocaleLowerCase().includes(needle)).map(({row,index,judgment})=>{const relevant=new Set(judgment.relevant),visible=[];const columns=names.map(name=>{const result=row.candidates[name]??{},mode=result.hybrid??result.lexical??result.semantic??{hits:[]};const hits=[...mode.hits].map(hit=>({...hit,blend:hit.lexicalScore==null||hit.semanticScore==null?hit.score:hit.lexicalScore*(1-weight)+hit.semanticScore*weight})).sort((a,b)=>b.blend-a.blend);for(const hit of hits){visible.push(hit.id,hit.documentId)}return '<section class="candidate-card"><h4>'+esc(name)+'</h4>'+hits.map((hit,rank)=>{const checked=relevant.has(hit.id)||relevant.has(hit.documentId),classes=checked?'hit relevant':'hit';return '<label class="'+classes+'"><span class="hit-row"><input class="relevance" type="checkbox" data-index="'+index+'" data-id="'+esc(hit.id)+'" data-document="'+esc(hit.documentId)+'" '+(checked?'checked':'')+'><span><strong>'+(rank+1)+'. '+esc(hit.title)+'</strong><div>'+esc(hit.url)+'</div><span class="score breakdown">blend '+number(hit.blend)+(hit.lexicalScore==null?'':' · lexical '+number(hit.lexicalScore))+(hit.semanticScore==null?'':' · semantic '+number(hit.semanticScore))+'</span></span></span></label>'}).join('')+'</section>'}).join('');const missing=judgment.relevant.filter(key=>!visible.includes(key));return '<article class="card"><div class="query-heading"><strong>Eval query</strong><input class="judgment" data-query-index="'+index+'" value="'+esc(judgment.query)+'" aria-label="Eval query"></div><div class="muted">Check a result to mark its document relevant; uncheck it to mark it irrelevant.</div>'+(missing.length?'<div class="miss">Missing judged results: '+missing.map(esc).join(', ')+'</div>':'')+'<div class="compare-grid">'+columns+'</div></article>'});const queries=app.querySelector('#queries');queries.innerHTML=rows.join('')||'<div class="empty">No matching eval queries.</div>';for(const input of queries.querySelectorAll('.judgment')){input.onchange=()=>{current.judgments[Number(input.dataset.queryIndex)].query=input.value}}for(const input of queries.querySelectorAll('.relevance')){input.onchange=()=>{const judgment=current.judgments[Number(input.dataset.index)],relevant=new Set(judgment.relevant);if(input.checked){relevant.add(input.dataset.document||input.dataset.id)}else{relevant.delete(input.dataset.id);relevant.delete(input.dataset.document)}judgment.relevant=[...relevant];drawQueries(run,names,filter,weight)}}}
async function saveJudgments(){status.className='muted';status.textContent='Saving judgments…';try{const response=await fetch('/api/judgments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({judgments:current.judgments})});const result=await response.json();if(!response.ok)throw new Error(result.error);current.run.perQuery.forEach((row,index)=>{row.query=current.judgments[index].query;row.relevant=[...current.judgments[index].relevant]});status.textContent='Saved '+result.count+' judgments to '+result.file}catch(error){status.textContent=error.message;status.className='error'}}
document.querySelector('#bench').onclick=async()=>{status.textContent='Benchmark running…';try{const response=await fetch('/api/bench',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});if(!response.ok)throw new Error((await response.json()).error);status.textContent='Benchmark complete';await refresh()}catch(error){status.textContent=error.message;status.className='error'}};
refresh().catch(error=>{status.textContent=error.message;status.className='error'});
</script>
</body></html>`;

function sendJSON(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function bodyJSON(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > 1_000_000) throw new Error("Request body exceeds 1 MB");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function bodyObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  return Object.fromEntries(Object.entries(value));
}

function parseJudgment(value: unknown, index: number): EvalJudgment {
  const judgment = bodyObject(value);
  if (typeof judgment.query !== "string" || !Array.isArray(judgment.relevant)) {
    throw new Error(`Invalid judgment at index ${index}`);
  }
  const relevant = judgment.relevant.filter(
    (entry: unknown): entry is string => typeof entry === "string",
  );
  if (relevant.length !== judgment.relevant.length) {
    throw new Error(`Invalid judgment at index ${index}`);
  }
  const result: EvalJudgment = { query: judgment.query, relevant };
  if (typeof judgment.notes === "string") result.notes = judgment.notes;
  if (typeof judgment.synthetic === "boolean") result.synthetic = judgment.synthetic;
  return result;
}

function inside(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Path must stay inside the project root");
  }
  return resolved;
}

async function listRuns(
  directory: string,
): Promise<Array<{ file: string; label: string; createdAt: string; candidates: string[] }>> {
  const files = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const runs = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        try {
          const run = await readRun(path.join(directory, file));
          return {
            file,
            label: run.label,
            createdAt: run.createdAt,
            candidates: Object.keys(run.candidates),
          };
        } catch {
          return undefined;
        }
      }),
  );
  const present = runs.filter((run): run is NonNullable<typeof run> => run !== undefined);
  // eslint-disable-next-line unicorn/no-array-sort -- the package targets Node 20, before toSorted
  return present.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const openArguments = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, openArguments, { detached: true, stdio: "ignore" });
  child.unref();
}

export async function serveLab(options: ServeLabOptions = {}): Promise<LabServer> {
  const root = path.resolve(options.root ?? process.cwd());
  const runDirectory = inside(root, ".seekite/bench");
  await mkdir(runDirectory, { recursive: true });
  const config: SearchConfigWithBench | undefined = options.config;
  const server = createServer(async (request, response) => {
    try {
      const requestURL = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && requestURL.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(page);
        return;
      }
      if (request.method === "GET" && requestURL.pathname === "/api/runs") {
        sendJSON(response, 200, await listRuns(runDirectory));
        return;
      }
      if (request.method === "GET" && requestURL.pathname.startsWith("/api/runs/")) {
        const file = decodeURIComponent(requestURL.pathname.slice("/api/runs/".length));
        if (path.basename(file) !== file || !file.endsWith(".json"))
          throw new Error("Invalid run file");
        sendJSON(response, 200, await readRun(path.join(runDirectory, file)));
        return;
      }
      if (request.method === "POST" && requestURL.pathname === "/api/bench") {
        if (!config) throw new Error("serveLab requires config to trigger a benchmark");
        const body = bodyObject(await bodyJSON(request));
        if (body.label !== undefined && typeof body.label !== "string") {
          throw new Error("label must be a string");
        }
        if (body.cold !== undefined && typeof body.cold !== "boolean") {
          throw new Error("cold must be a boolean");
        }
        const outcome = await bench(config, {
          root,
          label: body.label,
          cold: body.cold,
          quiet: true,
        });
        sendJSON(response, 201, { file: path.basename(outcome.file), run: outcome.run });
        return;
      }
      if (request.method === "POST" && requestURL.pathname === "/api/judgments") {
        if (!config) throw new Error("serveLab requires config to save judgments");
        const body = bodyObject(await bodyJSON(request));
        if (!Array.isArray(body.judgments)) throw new Error("judgments must be an array");
        if (body.file !== undefined && typeof body.file !== "string") {
          throw new Error("file must be a string");
        }
        const judgments = body.judgments.map(parseJudgment);
        const configuredFile = config.bench?.queries ?? "bench/queries.jsonl";
        const file = inside(root, body.file ?? configuredFile);
        await mkdir(path.dirname(file), { recursive: true });
        const lines = judgments.map((judgment) => JSON.stringify(judgment)).join("\n");
        await writeFile(file, lines ? `${lines}\n` : "");
        sendJSON(response, 200, { file: path.relative(root, file), count: judgments.length });
        return;
      }
      sendJSON(response, 404, { error: "Not found" });
    } catch (error) {
      sendJSON(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 4178, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Unable to determine lab server address");
  const host = address.address.includes(":") ? `[${address.address}]` : address.address;
  const url = `http://${host}:${address.port}`;
  if (options.open) openBrowser(url);
  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
