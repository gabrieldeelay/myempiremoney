import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const connection = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!connection) throw new Error("POSTGRES_URL não configurada.");

const sql = postgres(connection, { ssl: "require", max: 1 });

await sql.unsafe(`
  create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null,
    name text,
    phone text,
    document text,
    role text not null default 'user' check (role in ('user','admin')),
    access_granted boolean not null default false,
    access_status text not null default 'pending',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  alter table public.profiles add column if not exists phone text;

  create table if not exists public.app_settings (
    key text primary key,
    value jsonb not null,
    updated_at timestamptz not null default now()
  );

  create table if not exists public.private_settings (
    key text primary key,
    value text not null,
    updated_at timestamptz not null default now()
  );

  create table if not exists public.payments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    request_number text unique not null,
    transaction_id text,
    amount numeric(12,2) not null,
    status text not null default 'pending',
    pix_code text,
    qr_url text,
    expires_at timestamptz,
    raw jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.password_reset_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    token_hash text unique not null,
    expires_at timestamptz not null,
    used_at timestamptz,
    created_at timestamptz not null default now()
  );

  create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as $$
  begin
    insert into public.profiles (id, email, name, phone)
    values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'name', ''), coalesce(new.raw_user_meta_data->>'phone', ''))
    on conflict (id) do nothing;
    return new;
  end;
  $$;

  drop trigger if exists on_auth_user_created on auth.users;
  create trigger on_auth_user_created after insert on auth.users
    for each row execute procedure public.handle_new_user();

  alter table public.profiles enable row level security;
  alter table public.app_settings enable row level security;
  alter table public.private_settings enable row level security;
  alter table public.payments enable row level security;
  alter table public.password_reset_tokens enable row level security;

  drop policy if exists "profiles_select_own" on public.profiles;
  create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
  drop policy if exists "settings_public_read" on public.app_settings;
  create policy "settings_public_read" on public.app_settings for select to anon, authenticated using (true);
  drop policy if exists "payments_select_own" on public.payments;
  create policy "payments_select_own" on public.payments for select to authenticated using (auth.uid() = user_id);

  insert into public.app_settings (key, value) values
    ('pricing', '{"oldPrice":1499,"currentPrice":499.90}'::jsonb),
    ('content', '{"eyebrow":"SEU ASSISTENTE DE OPERAÇÃO","headline":"Operar sem contexto aumenta o risco.","subheadline":"O Atlas lê o contexto, organiza as informações e fica ao seu lado antes de cada decisão. Você continua no controle e não precisa decidir no escuro."}'::jsonb),
    ('market', '{"newsQuery":"(bitcoin OR ethereum OR \\"central bank\\" OR inflation OR markets)","symbols":["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","ADAUSDT","DOGEUSDT","LTCUSDT","AVAXUSDT"]}'::jsonb)
  on conflict (key) do nothing;

  update public.app_settings
  set value = jsonb_set(value, '{newsQuery}', to_jsonb('(bitcoin OR ethereum OR "central bank" OR inflation OR markets)'::text)), updated_at = now()
  where key = 'market' and value->>'newsQuery' = '(mercado OR economia OR inflação OR juros OR bitcoin OR criptomoedas)';

  update public.app_settings
  set value = jsonb_build_object(
    'eyebrow', coalesce(value->>'eyebrow', 'SEU ASSISTENTE DE OPERAÇÃO'),
    'headline', 'Operar sem contexto aumenta o risco.',
    'subheadline', 'O Atlas lê o contexto, organiza as informações e fica ao seu lado antes de cada decisão. Você continua no controle e não precisa decidir no escuro.'
  ), updated_at = now()
  where key = 'content' and (value->>'headline' ilike '%burrice%' or value->>'subheadline' like '%—%');
`);

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const adminPassword = process.env.ATLAS_ADMIN_SEED_PASSWORD;
if (!supabaseUrl || !serviceKey || !adminPassword) throw new Error("Credenciais de seed ausentes.");
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const adminEmail = "admin@atlas.local";
const { data: listed, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) throw listError;
let admin = listed.users.find(user => user.email === adminEmail);
if (!admin) {
  const { data, error } = await supabase.auth.admin.createUser({ email: adminEmail, password: adminPassword, email_confirm: true, user_metadata: { name: "Administrador Atlas", username: "admin" } });
  if (error) throw error;
  admin = data.user;
}
await supabase.from("profiles").upsert({ id: admin.id, email: adminEmail, name: "Administrador Atlas", role: "admin", access_granted: true, access_status: "active" });

await sql.end();
console.log("Banco e administrador configurados.");
