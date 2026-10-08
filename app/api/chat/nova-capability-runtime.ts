import type { CapabilityDecision, NovaCapability } from "./nova-capability";

export type NovaToolRisk = "read" | "compute" | "write" | "external";
export type NovaToolContext = { objective: string; input?: unknown; signal?: AbortSignal };
export type NovaToolResult = { ok: boolean; tool: string; capability: NovaCapability; output?: unknown; error?: string; verified?: boolean };
export type NovaTool = {
  name: string; capability: NovaCapability; description: string; risk: NovaToolRisk;
  requiresPermission: boolean; requiresExternalTool: boolean;
  execute: (context: NovaToolContext) => Promise<NovaToolResult> | NovaToolResult;
};
export type NovaExecutionPlan = {
  status: "ready" | "needs_permission" | "unsupported";
  primaryTool: string | null; supportingTools: string[]; missingCapabilities: NovaCapability[];
  requiresPermission: boolean; rationale: string[];
};

const unsupported=(name:string,capability:NovaCapability,description:string,requiresPermission=false):NovaTool=>({
 name,capability,description,risk:requiresPermission?"external":"read",requiresPermission,requiresExternalTool:true,
 execute:async()=>({ok:false,tool:name,capability,error:"Capability is not connected to this runtime.",verified:false})
});

const localTools:NovaTool[]=[
 {name:"time.now",capability:"time",description:"Resolve the current date and time for an explicit IANA timezone.",risk:"compute",requiresPermission:false,requiresExternalTool:false,
  execute:({input})=>{const timezone=typeof input==="string"&&input.trim()?input.trim():"UTC";try{const now=new Date();const formatted=new Intl.DateTimeFormat("en-IN",{timeZone:timezone,dateStyle:"full",timeStyle:"long"}).format(now);return{ok:true,tool:"time.now",capability:"time",output:{timezone,iso:now.toISOString(),local:formatted},verified:true};}catch{return{ok:false,tool:"time.now",capability:"time",error:"Invalid timezone.",verified:false};}}},

 {name:"security.inspect",capability:"security",description:"Inspect text for prompt-injection and exposed-secret patterns.",risk:"compute",requiresPermission:false,requiresExternalTool:false,
  execute:({objective})=>{const checks=[{name:"prompt-injection",pattern:/ignore (all|any|previous|prior) instructions|reveal (the )?(system|developer|hidden) prompt|disable (security|safety|guardrails)/i},{name:"secret-like-token",pattern:/(?:sk-|ci_live_|ghp_|xox[baprs]-)[A-Za-z0-9_-]{12,}/i}];const findings=checks.filter(c=>c.pattern.test(objective)).map(c=>c.name);return{ok:true,tool:"security.inspect",capability:"security",output:{safe:findings.length===0,findings},verified:true};}},
 {name:"verify.result",capability:"verify",description:"Verify a capability result is explicit and does not claim unavailable execution.",risk:"compute",requiresPermission:false,requiresExternalTool:false,
  execute:({input})=>{const r=input as Partial<NovaToolResult>|undefined;const verified=Boolean(r?.ok)&&r?.verified!==false;return{ok:true,tool:"verify.result",capability:"verify",output:{verified,reason:verified?"result is explicitly successful":"result is not verified"},verified:true};}},
 unsupported("research.search","research","Search connected web/research sources."),
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
const preferredTool:Partial<Record<NovaCapability,string>>={time:"time.now",research:"research.search",files:"files.inspect",vision:"vision.inspect",voice:"voice.process",memory:"memory.retrieve",build:"build.project",analyze:"analyze.data",create:"create.artifact",act:"act.external",security:"security.inspect",verify:"verify.result"};
export function listNovaTools(){return[...registry.values()];}
export function resolveNovaTool(capability:NovaCapability){const name=preferredTool[capability];return name?registry.get(name)||null:null;}
export function createNovaExecutionPlan(decision:CapabilityDecision):NovaExecutionPlan{
 const selected=[decision.primary,...decision.supporting],tools=selected.map(resolveNovaTool).filter((t):t is NovaTool=>Boolean(t));
 const missingCapabilities=selected.filter(c=>!resolveNovaTool(c)),unavailable=tools.filter(t=>t.requiresExternalTool),requiresPermission=decision.requiresPermission||tools.some(t=>t.requiresPermission);
 return{status:requiresPermission?"needs_permission":unavailable.length||missingCapabilities.length?"unsupported":"ready",primaryTool:resolveNovaTool(decision.primary)?.name||null,supportingTools:tools.filter(t=>t.capability!==decision.primary).map(t=>t.name),missingCapabilities,requiresPermission,rationale:[...decision.rationale,...unavailable.map(t=>t.name+" is not connected"),...(requiresPermission?["external side effect requires explicit permission"]:[])]};
}
export async function executeNovaCapability(toolName:string,context:NovaToolContext,permissionGranted=false):Promise<NovaToolResult>{
 const tool=registry.get(toolName); if(!tool)return{ok:false,tool:toolName,capability:"reason",error:"Unknown NOVA tool.",verified:false};
 if(tool.requiresPermission&&!permissionGranted)return{ok:false,tool:tool.name,capability:tool.capability,error:"Permission required before this action can execute.",verified:false};
 return tool.execute(context);
}
export function buildRuntimeInstruction(plan:NovaExecutionPlan){
 return["NOVA Capability Runtime:","Execution status: "+plan.status,"Primary tool: "+(plan.primaryTool||"none"),"Supporting tools: "+(plan.supportingTools.join(", ")||"none"),"Missing capabilities: "+(plan.missingCapabilities.join(", ")||"none"),"Permission gate: "+String(plan.requiresPermission),"Never claim an unsupported tool executed.","Never bypass the permission gate for an external side effect."].join("\n");
}
