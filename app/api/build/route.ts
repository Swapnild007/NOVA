import {createNovaPlan,prepareNovaMessages} from "../chat/nova-gateway";
import {requestNovaIntelligence} from "../chat/intelligence-gateway";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type Msg={role:"user"|"assistant"|"system";content:string};
type File={path:string;content:string};
type Project={name:string;summary:string;files:File[];verification:{passed:boolean;checks:string[]}};
type Existing={name:string;summary?:string;files:File[]};

function sanitize(x:unknown):Msg[]{if(!Array.isArray(x))return[];return x.filter((m):m is Msg=>!!m&&typeof m==="object"&&typeof(m as Msg).content==="string"&&["user","assistant","system"].includes((m as Msg).role)).slice(-20)}
function extract(text:string):Project{
 const fenced=text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i),raw=fenced?.[1]||text,start=raw.indexOf("{"),end=raw.lastIndexOf("}");
 if(start<0||end<=start)throw new Error("Builder returned invalid project JSON.");
 const p=JSON.parse(raw.slice(start,end+1)) as Partial<Project>;
 if(typeof p.name!=="string"||!Array.isArray(p.files))throw new Error("Builder returned an invalid project shape.");
 const files=p.files.filter((f):f is File=>!!f&&typeof f==="object"&&typeof f.path==="string"&&typeof f.content==="string"&&!f.path.includes("..")&&!f.path.startsWith("/")).slice(0,12);
 if(!files.some(f=>f.path==="index.html"))throw new Error("index.html is required.");
 const checks=["JSON parsed successfully.","All paths are relative and contain no parent traversal.","index.html is present.",files.some(f=>f.path==="styles.css")?"styles.css is present.":"styles.css was not required.",files.some(f=>f.path==="app.js")?"app.js is present.":"app.js was not required."];
 return {name:p.name.slice(0,80),summary:typeof p.summary==="string"?p.summary.slice(0,500):"",files,verification:{passed:Boolean(p.verification?.passed),checks}};
}
export async function POST(req:Request){
 try{
  const body=await req.json() as {messages?:unknown;project?:unknown},messages=sanitize(body.messages);
  if(!messages.length)return new Response("Tell NOVA what you want to build.",{status:400});
  const existing:Existing|null=body.project&&typeof body.project==="object"&&Array.isArray((body.project as Existing).files)?{
   name:typeof(body.project as Existing).name==="string"?(body.project as Existing).name:"NOVA Project",
   summary:typeof(body.project as Existing).summary==="string"?(body.project as Existing).summary:"",
   files:(body.project as Existing).files.filter(f=>!!f&&typeof f.path==="string"&&typeof f.content==="string"&&!f.path.includes("..")&&!f.path.startsWith("/")).slice(0,12)
  }:null;
  const plan=createNovaPlan(messages),prepared=prepareNovaMessages(messages,16);
  const system=["You are NOVA's autonomous product builder.","Return ONLY one valid JSON object.","Build a complete browser-runnable project using index.html, styles.css and app.js when appropriate.","If an existing project is supplied, preserve working behavior and apply the user's latest request.","Do not use absolute paths, parent traversal, tracking, hidden network dependencies, or remote scripts unless explicitly requested.","Perform a structural self-check before returning.","Do not claim runtime tests were executed. The NOVA server only performs static structural validation.",'Schema: {"name":"string","summary":"string","files":[{"path":"string","content":"string"}],"verification":{"passed":true,"checks":["string"]}}'].join("\n");
  const requestBody={messages:[{role:"system",content:system+(existing?"\nEXISTING PROJECT SNAPSHOT:\n"+JSON.stringify(existing):"")},...prepared],stream:false};
  const attempt=await requestNovaIntelligence({...plan,intent:"build"},requestBody);
  if(!attempt)return new Response("NOVA builder gateway is not configured. Set NOVA_GATEWAY_URL, NOVA_GATEWAY_API_KEY, and NOVA_GATEWAY_MODEL.",{status:503});
  if(!attempt.response.ok){const d=await attempt.response.text().catch(()=>"");return new Response("NOVA builder gateway failed ("+attempt.response.status+"). "+d.slice(0,400),{status:200})}
  const j=await attempt.response.json(),text=j?.choices?.[0]?.message?.content;
  if(typeof text!=="string"||!text.trim())return new Response("NOVA's builder returned no project artifact.",{status:200});
  let project:Project;try{project=extract(text)}catch(e){return new Response("NOVA's builder returned an invalid project artifact: "+(e instanceof Error?e.message:String(e)),{status:200})}
  return new Response("__NOVA_PROJECT__"+JSON.stringify(project),{headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store","X-NOVA-Intent":"build","X-NOVA-Verified":String(project.verification.passed)}});
 }catch(e){return new Response("NOVA's builder failed: "+(e instanceof Error?e.message:String(e)),{status:200})}
}