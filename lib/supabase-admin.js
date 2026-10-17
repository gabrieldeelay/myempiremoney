const { createClient } = require("@supabase/supabase-js");

let adminClient;

function getAdminClient() {
  if (!adminClient) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error("Supabase não configurado.");
    adminClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return adminClient;
}

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function requireUser(req) {
  const token = bearerToken(req);
  if (!token) {
    const error = new Error("Faça login para continuar.");
    error.status = 401;
    throw error;
  }
  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    const authError = new Error("Sua sessão expirou. Entre novamente.");
    authError.status = 401;
    throw authError;
  }
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).maybeSingle();
  return { supabase, user: data.user, profile };
}

async function requireAdmin(req) {
  const context = await requireUser(req);
  if (context.profile?.role !== "admin") {
    const error = new Error("Acesso restrito ao administrador.");
    error.status = 403;
    throw error;
  }
  return context;
}

function sendError(res, error) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: status >= 500 ? "O Atlas encontrou um erro interno." : error.message });
}

module.exports = { getAdminClient, requireUser, requireAdmin, sendError };
