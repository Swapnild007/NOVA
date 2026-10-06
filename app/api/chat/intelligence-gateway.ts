import type { NovaGatewayPlan } from "./nova-gateway";
export type NovaIntelligenceAttempt={source:"gateway";label:"NOVA Gateway";model:string;response:Response};
const env=(n:string)=>process.env[n]?.trim();
export async function requestNovaIntelligence(plan:NovaGatewayPlan,body:Record<string,unknown>):Promise<NovaIntelligenceAttempt|null>{
 const base=(env("NOVA_GATEWAY_URL")||"").replace(/\/+$/,""),key=env("NOVA_GATEWAY_API_KEY"),model=plan.model;
 if(!base||!key||!model)return null;
 const headers:Record<string,string>={Authorization:"Bearer "+key,"Content-Type":"application/json",Accept:"text/event-stream"};
 if((env("NOVA_GATEWAY_ROUTE")||"auto")==="auto")headers["X-CI-Route"]="auto";
 try{
  const payload={...body,model,...(env("NOVA_GATEWAY_ZDR")==="true"?{zdr:true}:{})};
  const response=await fetch(base+"/chat/completions",{method:"POST",headers,body:JSON.stringify(payload),cache:"no-store",
   signal:AbortSignal.timeout(Number(env("NOVA_GATEWAY_TIMEOUT_MS")||45000))});
  return {source:"gateway",label:"NOVA Gateway",model,response};
 }catch{return null;}
}