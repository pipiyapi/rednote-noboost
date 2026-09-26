// Offline UI fixture: real popup/render code, synthetic responses, no OCR/model/network calls.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";

const bundle = async (code) => (await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: "ts" }, bundle: true, write: false, format: "iife" })).outputFiles[0].text;
const fixture = `
import { makeJevState } from './extension/src/shared/jevInput';
import { decide } from './extension/src/shared/decide';
import { createEmptyStats } from './extension/src/content/scanStats';
import { SCAN_PROTOCOL_VERSION } from './extension/src/contracts/scanProtocol';
const body={status:'success',text:'限时抢购课程，名额有限。需要购买的朋友请私信咨询，加入购买群后立即下单。',elapsedMs:125,source:'background_detail',noteType:'normal',imageCount:5,truncated:false};
const ocr={status:'success',model:'PP-OCRv6 Small',coverUrl:'',text:'限时抢购',lines:[{text:'限时抢购',score:.99}],elapsedMs:450,recognizedCount:1,detectedBoxes:1};
const state=makeJevState('课程限时抢购',body,ocr);
const answers={commercial_intent:{noul:.97},commercial_call_to_action:{noul:.94},pure_emotional_expression:{noul:.05},polarization_or_anxiety:{noul:.04},information_value:{noul:.12},adversarial_instruction:{noul:.01}};
const decision=decide(answers,'title+page_text+ocr',state);
const history=[{noteId:'fixture-note',title:'课程限时抢购（模拟数据）',createdAt:100,updatedAt:200,stage:'done',body,ocr,jevCalls:[{input:{state,model:'jev-1.13.0',source:'title+page_text+ocr',questions:{}},output:{answers},decision,startedAt:100,elapsedMs:200,billing:{status:'estimated',inputTokens:3000,estimatedUsd:.000126,rateUsdPerMillion:.042}}],finalDecision:decision}];
globalThis.chrome={runtime:{sendMessage:async(m)=>m.type==='GET_JEV_USAGE'?{type:'JEV_USAGE',usage:{calls:50,pricedCalls:49,inputTokens:147000,estimatedUsd:.006174,since:Date.now()}}:{type:'OCR_HEALTH_RESULT',status:'healthy',message:'本地识别自检通过；只识别封面。'},openOptionsPage(){}},tabs:{query:async()=>[{id:1,url:'https://www.xiaohongshu.com/explore'}],sendMessage:async()=>({type:'SCAN_STATS',protocolVersion:SCAN_PROTOCOL_VERSION,state:'paused',stats:{...createEmptyStats(),discovered:1,decided:1,filterCommercial:1},history})},storage:{local:{get:(_k,cb)=>cb({}),set:async()=>{}}}};
await import('./extension/src/ui/popup');
`;
// esbuild iife cannot use top-level await; import via promise remains local to the bundle.
const popupJs = await bundle(fixture.replace("await import", "void import"));
let popup = await readFile("extension/src/ui/popup.html", "utf8");
popup = popup.replace(/<script type="module"[^>]*><\/script>/, () => `<script>${popupJs.replace(/<\/script/gi, "<\\/script")}</script>`);
const overlayJs = await bundle(`import {buildOverlay} from './extension/src/content/cardController';document.querySelector('#card').append(buildOverlay({status:'filter_both',source:'title+page_text+ocr',reasons:[],checks:[{key:'commercial_intent',label:'商业转化意图',probability:.97,operator:'>=',threshold:.85,category:'commercial'},{key:'information_value',label:'有独立信息价值',probability:.12,operator:'<=',threshold:.35,category:'commercial'},{key:'pure_emotional_expression',label:'缺少事实支撑的情绪宣泄',probability:.96,operator:'>=',threshold:.9,category:'emotional'},{key:'information_value',label:'有独立信息价值',probability:.12,operator:'<=',threshold:.3,category:'emotional'}]},()=>document.querySelector('.rnb-overlay').remove()));`);
const css = await readFile("extension/src/content/styles.css", "utf8");
const overlay = `<html><head><meta charset="utf-8"><style>${css}body{margin:0}#card{height:560px;width:100%;position:relative;background:#eee}</style></head><body><div id="card">原文（模拟卡片）</div><script>${overlayJs}</script></body></html>`;
const html = `<html lang="zh-CN"><meta charset="utf-8"><title>正文与费用 UI 离线验证</title><style>body{font:14px system-ui;margin:16px;color:#25211f;background:#eee}main{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}iframe{border:1px solid #ccc;display:block}h2{font-size:14px}#checks{white-space:pre-wrap}</style><h1>离线模拟 · 不产生调用费用</h1><pre id="checks">正在测量…</pre><main><section><h2>真实面板代码 · 390px</h2><iframe id="popup" width="390" height="780"></iframe></section><section><h2>蒙版最复杂情况 · 240px</h2><iframe id="overlay" width="240" height="560"></iframe></section></main><script>
const p=document.querySelector('#popup'),o=document.querySelector('#overlay');p.srcdoc=${JSON.stringify(popup).replace(/</g, "\\u003c")};o.srcdoc=${JSON.stringify(overlay).replace(/</g, "\\u003c")};
p.onload=()=>{setTimeout(()=>{const results=[];for(const width of [390,1024]){p.width=width;const d=p.contentDocument.documentElement;results.push({width,overflow:d.scrollWidth-d.clientWidth});}p.width=390;document.querySelector('#checks').textContent=JSON.stringify(results);},150)};
</script></html>`;
await mkdir(".tmp", { recursive: true });
await writeFile(".tmp/body-ui.html", html);
console.log(".tmp/body-ui.html generated (synthetic data only)");
