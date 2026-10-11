import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return respond(405, { error: "Method not allowed." });
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return respond(400, { error: "A valid user ID and password are required." });
  }

  if (!requestBody || typeof requestBody !== "object") {
    return respond(400, { error: "A valid user ID and password are required." });
  }
  const body = requestBody as Record<string, unknown>;
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId) ||
    password.length === 0 ||
    password.length > 1024
  ) {
    return respond(400, { error: "A valid user ID and password are required." });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return respond(500, { error: "Admin sign-in is not configured on the server." });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const publicClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: adminRecord, error: adminQueryError } = await adminClient
    .from("canteen_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (adminQueryError) {
    return respond(500, { error: "Admin sign-in is temporarily unavailable." });
  }
  if (!adminRecord) {
    return respond(401, { error: "Invalid user ID or password." });
  }

  const { data: userData, error: userLookupError } = await adminClient.auth.admin.getUserById(userId);
  if (userLookupError || !userData.user?.email) {
    return respond(401, { error: "Invalid user ID or password." });
  }

  const { data: signInData, error: signInError } = await publicClient.auth.signInWithPassword({
    email: userData.user.email,
    password
  });
  if (signInError || !signInData.session) {
    return respond(401, { error: "Invalid user ID or password." });
  }

  return respond(200, { session: signInData.session });
});
