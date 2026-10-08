import type { CapabilityDecision, NovaCapability } from "./nova-capability";

export type NovaToolRisk = "read" | "compute" | "write" | "external";
export type NovaToolContext = { objective: string; input?: unknown; signal?: AbortSignal };
export type NovaToolResult = { ok: boolean; tool: string; capability: NovaCapability; output?: unknown; error?: string; verified?: boolean };
export type NovaTool = {
  name: string; capability: NovaCapability; description: string; risk: NovaToolRisk;
  requiresPermission: boolean; requiresExternalTool: boolean; connected: () => boolean;
  execute: (context: NovaToolContext) => Promise<NovaToolResult> | NovaToolResult;
};
export type NovaExecutionPlan = {
  status: "ready" | "needs_permission" | "unsupported";
  primaryTool: string | null; supportingTools: string[]; missingCapabilities: NovaCapability[];
  requiresPermission: boolean; rationale: string[];
};

const env=(name:string)=>process.env[name]?.trim();
const gatewayConfigured=()=>Boolean((env("NOVA_GATEWAY_URL")&&env("NOVA_GATEWAY_API_KEY"))||env("OPENROUTER_API_KEY"));
const neverConnected=()=>false;
const alwaysConnected=()=>true;

const unsupported=(name:string,capability:NovaCapability,description:string,requiresPermission=false):NovaTool=>({
 name,capability,description,risk:requiresPermission?"external":"read",requiresPermission,requiresExternalTool:true,connected:neverConnected,
 execute:async()=>({ok:false,tool:name,capability,error:"Capability is not connected to this runtime.",verified:false})
});

async function weatherNow(location:string, signal?:AbortSignal) {
  const query=location.trim();
  if(!query)return {ok:false,error:"A city or location is required."};
  const geoResponse=await fetch("https://geocoding-api.open-meteo.com/v1/search?name="+encodeURIComponent(query)+"&count=1&language=en&format=json",{cache:"no-store",signal});
  if(!geoResponse.ok)return {ok:false,error:"Weather location lookup failed."};
  const geo=await geoResponse.json() as {results?:Array<{name:string;latitude:number;longitude:number;country?:string;timezone?:string}>};
  const place=geo.results?.[0];
  if(!place)return {ok:false,error:"I couldn't find that location."};
  const url="https://api.open-meteo.com/v1/forecast?latitude="+place.latitude+"&longitude="+place.longitude+"&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&forecast_days=1&timezone=auto";
  const weatherResponse=await fetch(url,{cache:"no-store",signal});
  if(!weatherResponse.ok)return {ok:false,error:"Weather service returned an error."};
  const weather=await weatherResponse.json() as {current?:Record<string,number>;daily?:Record<string,Array<number|string>>;timezone?:string};
  if(!weather.current||!weather.daily)return {ok:false,error:"Weather data was incomplete."};
  return {ok:true,place,weather};
}

const localTools:NovaTool[]=[
 {name:"time.now",capability:"time",description:"Resolve the current date and time for an explicit IANA timezone.",risk:"compute",requiresPermission:false,requiresExternalTool:false,connected:alwaysConnected,
  execute:({input})=>{const timezone=typeof input==="string"&&input.trim()?input.trim():"UTC";try{const now=new Date();const formatted=new Intl.DateTimeFormat("en-IN",{timeZone:timezone,dateStyle:"full",timeStyle:"long"}).format(now);return{ok:true,tool:"time.now",capability:"time",output:{timezone,iso:now.toISOString(),local:formatted},verified:true};}catch{return{ok:false,tool:"time.now",capability:"time",error:"Invalid timezone.",verified:false};}}},
 {name:"weather.current",capability:"weather",description:"Resolve current weather and today's forecast for a named city or location.",risk:"read",requiresPermission:false,requiresExternalTool:true,connected:alwaysConnected,
  execute:async({input,signal})=>{const location=typeof input==="string"?input.trim():"";const result=await weatherNow(location,signal);return result.ok?{ok:true,tool:"weather.current",capability:"weather",output:result,verified:true}:{ok:false,tool:"weather.current",capability:"weather",error:result.error,verified:false};}},
 {name:"security.inspect",capability:"security",description:"Inspect text for prompt-injection and exposed-secret patterns.",risk:"compute",requiresPermission:false,requiresExternalTool:false,connected:alwaysConnected,
  execute:({objective})=>{const checks=[{name:"prompt-injection",pattern:/ignore (all|any|previous|prior) instructions|reveal (the )?(system|developer|hidden) prompt|disable (security|safety|guardrails)/i},{name:"secret-like-token",pattern:/(?:sk-|ci_live_|ghp_|xox[baprs]-)[A-Za-z0-9_-]{12,}/i}];const findings=checks.filter(c=>c.pattern.test(objective)).map(c=>c.name);return{ok:true,tool:"security.inspect",capability:"security",output:{safe:findings.length===0,findings},verified:true};}},
 {name:"verify.result",capability:"verify",description:"Verify a capability result is explicit and does not claim unavailable execution.",risk:"compute",requiresPermission:false,requiresExternalTool:false,connected:alwaysConnected,
  execute:({input})=>{const r=input as Partial<NovaToolResult>|undefined;const verified=Boolean(r?.ok)&&r?.verified!==false;return{ok:true,tool:"verify.result",capability:"verify",output:{verified,reason:verified?"result is explicitly successful":"result is not verified"},verified:true};}},
 {...unsupported("research.search","research","Search connected web/research sources."),connected:gatewayConfigured},
 unsupported("files.inspect","files","Inspect connected files and documents."),
 unsupported("vision.inspect","vision","Inspect connected image/visual input."),
 unsupported("voice.process","voice","Process connected voice input/output."),
 unsupported("memory.retrieve","memory","Retrieve persistent NOVA memory."),
 unsupported("build.project","build","Build through the NOVA project builder."),
 unsupported("analyze.data","analyze","Run deterministic data analysis."),
 unsupported("create.artifact","create","Create a durable artifact."),
 unsupported("act.external","act","Perform an external side effect.",true)
];
const registry=new Map(localTools.map(t=>[t.name,t]));
const preferredTool:Partial<Record<NovaCapability,string>>={time:"time.now",weather:"weather.current",research:"research.search",files:"files.inspect",vision:"vision.inspect",voice:"voice.process",memory:"memory.retrieve",build:"build.project",analyze:"analyze.data",create:"create.artifact",act:"act.external",security:"security.inspect",verify:"verify.result"};
export function listNovaTools(){return[...registry.values()];}
export function resolveNovaTool(capability:NovaCapability){const name=preferredTool[capability];return name?registry.get(name)||null:null;}
export function isNovaCapabilityConnected(capability:NovaCapability){const tool=resolveNovaTool(capability);return Boolean(tool?.connected());}
export function createNovaExecutionPlan(decision:CapabilityDecision):NovaExecutionPlan{
 const selected=[decision.primary,...decision.supporting],tools=selected.map(resolveNovaTool).filter((t):t is NovaTool=>Boolean(t));
 const missingCapabilities=selected.filter(c=>!isNovaCapabilityConnected(c)),unavailable=tools.filter(t=>!t.connected()),requiresPermission=decision.requiresPermission||tools.some(t=>t.requiresPermission);
 return{status:requiresPermission?"needs_permission":unavailable.length||missingCapabilities.length?"unsupported":"ready",primaryTool:resolveNovaTool(decision.primary)?.name||null,supportingTools:tools.filter(t=>t.capability!==decision.primary&&t.connected()).map(t=>t.name),missingCapabilities,requiresPermission,rationale:[...decision.rationale,...unavailable.map(t=>t.name+" is not connected"),...(requiresPermission?["external side effect requires explicit permission"]:[])]};
}
export async function executeNovaCapability(toolName:string,context:NovaToolContext,permissionGranted=false):Promise<NovaToolResult>{
 const tool=registry.get(toolName); if(!tool)return{ok:false,tool:toolName,capability:"reason",error:"Unknown NOVA tool.",verified:false};
 if(!tool.connected())return{ok:false,tool:tool.name,capability:tool.capability,error:"Capability is not connected to this runtime.",verified:false};
 if(tool.requiresPermission&&!permissionGranted)return{ok:false,tool:tool.name,capability:tool.capability,error:"Permission required before this action can execute.",verified:false};
 try{return await tool.execute(context)}catch(error){return{ok:false,tool:tool.name,capability:tool.capability,error:error instanceof Error?error.message:"Capability execution failed.",verified:false};}
}
export function buildRuntimeInstruction(plan:NovaExecutionPlan){
 return["NOVA Capability Runtime:","Execution status: "+plan.status,"Primary tool: "+(plan.primaryTool||"none"),"Supporting tools: "+(plan.supportingTools.join(", ")||"none"),"Missing capabilities: "+(plan.missingCapabilities.join(", ")||"none"),"Permission gate: "+String(plan.requiresPermission),"Never claim an unsupported tool executed.","Never bypass the permission gate for an external side effect."].join("\n");
}
