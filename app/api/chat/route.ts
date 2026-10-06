import {buildNovaSystem,createNovaPlan,prepareNovaMessages} from "./nova-gateway";
import {requestNovaIntelligence} from "./intelligence-gateway";
export const runtime="nodejs"; export const dynamic="force-dynamic";
type Msg={role:"user"|"assistant"|"system";content:string}; type Usage={prompt_tokens?:number;completion_tokens?:number;total_tokens?:number;cost?:number};
const MARK="__NOVA_USAGE__";
function detail(raw:string){const c=raw.replace(/(?:sk-|ci_live_)[A-Za-z0-9_-]+/g,"[redacted-key]");try{const j=JSON.parse(c);return String(j?.error?.message||j?.message||j?.error||c).slice(0,500)}catch{return c.replace(/\s+/g," ").slice(0,500)}}
function sanitize(x:unknown):Msg[]{if(!Array.isArray(x))return[];return x.filter((m):m is Msg=>!!m&&typeof m==="object"&&typeof(m as Msg).content==="string"&&["user","assistant","system"].includes((m as Msg).role)).slice(-40)}
function failure(s:number,d:string){const k=s===401?"authentication was rejected":s===402?"wallet balance or budget is insufficient":s===403?"the request was forbidden":s===404?"the model is unavailable":s===429?"the gateway rate-limited the request":s>=500?"the gateway returned a server error":"the gateway rejected the request";return"NOVA intelligence connection failed: "+k+"."+(d?" Detail: "+detail(d):"")}
export async function POST(req:Request){
 try{
  const body=await req.json() as {messages?:unknown}, valid=sanitize(body.messages); if(!valid.length)return new Response("NOVA needs a message to begin.",{status:400});
  const plan=createNovaPlan(valid),messages=prepareNovaMessages(valid,plan.contextMessages),objective=messages.filter(m=>m.role==="user").at(-1)?.content||"";
  const attempt=await requestNovaIntelligence(plan,{messages:[{role:"system",content:buildNovaSystem(plan,objective)},...messages],stream:true});
  if(!attempt)return new Response("NOVA gateway is not configured. Set NOVA_GATEWAY_URL, NOVA_GATEWAY_API_KEY, and an exact NOVA_GATEWAY_MODEL.",{status:503});
  if(!attempt.response.ok||!attempt.response.body){const d=await attempt.response.text().catch(()=>"");return new Response(failure(attempt.response.status,d),{status:200})}
  const reader=attempt.response.body.getReader(),decoder=new TextDecoder(),encoder=new TextEncoder();
  const stream=new ReadableStream<Uint8Array>({async start(controller){let buf="",usage:Usage|null=null;try{while(true){const{done,value}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});const events=buf.split(/\r?\n\r?\n/);buf=events.pop()||"";for(const e of events){const u=emit(e,controller,encoder);if(u)usage=u}}buf+=decoder.decode();if(buf){const u=emit(buf,controller,encoder);if(u)usage=u}if(usage)controller.enqueue(encoder.encode(MARK+JSON.stringify(usage)));controller.close()}catch(e){console.error("NOVA stream error",e);controller.error(e)}},cancel(){reader.cancel().catch(()=>{})}});
  return new Response(stream,{headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-cache, no-transform","X-NOVA-Intent":plan.intent,"X-NOVA-Provider":attempt.label,"X-NOVA-Shield":plan.shield.risk,"X-NOVA-Runtime":"enabled"}});
 }catch(e){return new Response("NOVA could not complete the request. Detail: "+detail(e instanceof Error?e.message:String(e)),{status:200})}
}
function emit(event:string,c:ReadableStreamDefaultController<Uint8Array>,enc:TextEncoder):Usage|null{let u:Usage|null=null;for(const line of event.split(/\r?\n/)){if(!line.startsWith("data:"))continue;const d=line.slice(5).trim();if(!d||d==="[DONE]")continue;try{const j=JSON.parse(d),delta=j?.choices?.[0]?.delta?.content;if(typeof delta==="string"&&delta)c.enqueue(enc.encode(delta));if(j?.usage)u={prompt_tokens:Number(j.usage.prompt_tokens||0),completion_tokens:Number(j.usage.completion_tokens||0),total_tokens:Number(j.usage.total_tokens||0),cost:typeof j.usage.cost==="number"?j.usage.cost:undefined}}catch{}}return u}