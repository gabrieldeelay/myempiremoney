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
    plan_id text,
    access_expires_at timestamptz,
    role text not null default 'user' check (role in ('user','admin')),
    access_granted boolean not null default false,
    access_status text not null default 'pending',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  alter table public.profiles add column if not exists phone text;
  alter table public.profiles add column if not exists plan_id text;
  alter table public.profiles add column if not exists access_expires_at timestamptz;

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
    original_amount numeric(12,2),
    discount_amount numeric(12,2) not null default 0,
    plan_id text not null default 'lifetime',
    status text not null default 'pending',
    pix_code text,
    qr_url text,
    expires_at timestamptz,
    raw jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.coupons (
    id uuid primary key default gen_random_uuid(),
    code text unique not null,
    type text not null check (type in ('percent','fixed')),
    value numeric(12,2) not null check (value > 0),
    valid_from timestamptz,
    valid_until timestamptz,
    max_uses integer,
    uses_count integer not null default 0,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  alter table public.payments add column if not exists original_amount numeric(12,2);
  alter table public.payments add column if not exists discount_amount numeric(12,2) not null default 0;
  alter table public.payments add column if not exists plan_id text not null default 'lifetime';
  alter table public.payments add column if not exists coupon_id uuid references public.coupons(id) on delete set null;
  alter table public.payments add column if not exists coupon_redeemed_at timestamptz;

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
  alter table public.coupons enable row level security;
  alter table public.password_reset_tokens enable row level security;

  drop policy if exists "profiles_select_own" on public.profiles;
  create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
  drop policy if exists "settings_public_read" on public.app_settings;
  create policy "settings_public_read" on public.app_settings for select to anon, authenticated using (true);
  drop policy if exists "payments_select_own" on public.payments;
  create policy "payments_select_own" on public.payments for select to authenticated using (auth.uid() = user_id);

  create or replace function public.activate_atlas_payment(p_payment_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
  declare
    current_payment public.payments%rowtype;
  begin
    select * into current_payment from public.payments where id = p_payment_id for update;
    if not found then return; end if;
    if current_payment.coupon_id is not null and current_payment.coupon_redeemed_at is null then
      update public.coupons set uses_count = uses_count + 1, updated_at = now() where id = current_payment.coupon_id;
      update public.payments set coupon_redeemed_at = now() where id = current_payment.id;
    end if;
    update public.payments set status = 'confirmed', updated_at = now() where id = current_payment.id;
    if current_payment.plan_id = 'monthly' then
      update public.profiles set access_granted = true, access_status = 'active', plan_id = 'monthly', access_expires_at = greatest(now(), coalesce(access_expires_at, now())) + interval '30 days', updated_at = now() where id = current_payment.user_id;
    else
      update public.profiles set access_granted = true, access_status = 'active', plan_id = 'lifetime', access_expires_at = null, updated_at = now() where id = current_payment.user_id;
    end if;
  end;
  $$;

  revoke all on function public.activate_atlas_payment(uuid) from public, anon, authenticated;
  grant execute on function public.activate_atlas_payment(uuid) to service_role;

  insert into public.app_settings (key, value) values
    ('pricing', '{"oldPrice":1499,"currentPrice":499.90}'::jsonb),
    ('plans', '{"monthly":{"id":"monthly","label":"Plano mensal","billing":"30 dias de acesso","oldPrice":199.90,"currentPrice":99.90,"active":true,"benefits":["Radar de notícias e tendências","Assistente durante as operações","Atualizações incluídas"]},"lifetime":{"id":"lifetime","label":"Plano vitalício","billing":"Acesso sem mensalidade","oldPrice":1499,"currentPrice":499.90,"active":true,"benefits":["Acesso vitalício ao Atlas","Radar de notícias e tendências","Atualizações incluídas"]}}'::jsonb),
    ('content', '{"eyebrow":"SEU ASSISTENTE DE OPERAÇÃO","headline":"Operar no escuro, não dá certo.","subheadline":"O Atlas lê o contexto, organiza as informações e fica ao seu lado antes de cada decisão. Você continua no controle e não precisa decidir no escuro."}'::jsonb),
    ('market', '{"newsQuery":"(bitcoin OR ethereum OR \\"central bank\\" OR inflation OR markets)","symbols":["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT","BNBUSDT","ADAUSDT","DOGEUSDT","LTCUSDT","AVAXUSDT"]}'::jsonb)
  on conflict (key) do nothing;

  update public.app_settings
  set value = jsonb_set(value, '{newsQuery}', to_jsonb('(bitcoin OR ethereum OR "central bank" OR inflation OR markets)'::text)), updated_at = now()
  where key = 'market' and value->>'newsQuery' = '(mercado OR economia OR inflação OR juros OR bitcoin OR criptomoedas)';

  update public.app_settings
  set value = jsonb_build_object(
    'eyebrow', coalesce(value->>'eyebrow', 'SEU ASSISTENTE DE OPERAÇÃO'),
    'headline', 'Operar no escuro, não dá certo.',
    'subheadline', 'O Atlas lê o contexto, organiza as informações e fica ao seu lado antes de cada decisão. Você continua no controle e não precisa decidir no escuro.'
  ), updated_at = now()
  where key = 'content' and (value->>'headline' in ('Operar sozinho é uma burrice cara.', 'Operar sem contexto aumenta o risco.') or value->>'subheadline' like '%—%');
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
