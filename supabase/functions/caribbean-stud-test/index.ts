import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
  "Content-Type":"application/json"
};

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  return new Response(JSON.stringify({error:"This GameDay poker game has been retired."}),{status:410,headers});
});
