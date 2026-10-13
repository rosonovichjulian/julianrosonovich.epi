-- ============================================================
-- Observatorio de Riesgo Cardiovascular
-- Julián Rosonovich · Epidemiología
-- Ejecutar completo, una sola vez, en Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1. MUNICIPIOS (clientes) ------------------------------------
create table if not exists public.municipios (
  id          text primary key,              -- usuario base, ej: malvinas-argentinas
  nombre      text not null,                 -- ej: Malvinas Argentinas
  provincia   text default 'Córdoba',
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

-- 2. PERFILES (una fila por usuario de la plataforma) ----------
-- rol: admin (vos, ve todo) · gestor (intendencia: ve el tablero de su municipio y carga)
--      encuestador (solo carga encuestas de su municipio)
create table if not exists public.perfiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  usuario       text not null unique,
  nombre        text,
  rol           text check (rol in ('admin','gestor','encuestador')),
  municipio_id  text references public.municipios(id),
  creado_en     timestamptz not null default now()
);

-- 3. ENCUESTAS -------------------------------------------------
create table if not exists public.encuestas (
  id            text primary key,                         -- código de encuesta generado en el teléfono
  municipio_id  text not null references public.municipios(id),
  zona          text not null,
  fecha         date not null,
  encuestador   text not null,
  datos         jsonb not null,                           -- respuestas y mediciones
  creado_por    uuid not null default auth.uid() references auth.users(id),
  creado_en     timestamptz not null default now()
);
create index if not exists encuestas_municipio_idx on public.encuestas (municipio_id, fecha);

-- 4. Crear el perfil automáticamente al crear un usuario --------
create or replace function public.crear_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, usuario)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

-- 5. Funciones auxiliares para los permisos ----------------------
create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.perfiles where id = auth.uid()
$$;

create or replace function public.mi_municipio() returns text
language sql stable security definer set search_path = public as $$
  select municipio_id from public.perfiles where id = auth.uid()
$$;

-- 6. PERMISOS (Row Level Security) -------------------------------
alter table public.municipios enable row level security;
alter table public.perfiles   enable row level security;
alter table public.encuestas  enable row level security;

-- Municipios: cada usuario ve el suyo; el admin ve y edita todos
drop policy if exists municipios_ver on public.municipios;
create policy municipios_ver on public.municipios for select
  using (public.mi_rol() = 'admin' or id = public.mi_municipio());
drop policy if exists municipios_admin on public.municipios;
create policy municipios_admin on public.municipios for all
  using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');

-- Perfiles: cada uno ve el suyo; el gestor ve los de su municipio; el admin ve y edita todos
drop policy if exists perfiles_ver on public.perfiles;
create policy perfiles_ver on public.perfiles for select
  using (id = auth.uid()
         or public.mi_rol() = 'admin'
         or (public.mi_rol() = 'gestor' and municipio_id = public.mi_municipio()));
drop policy if exists perfiles_admin on public.perfiles;
create policy perfiles_admin on public.perfiles for update
  using (public.mi_rol() = 'admin') with check (public.mi_rol() = 'admin');

-- Encuestas: ver
drop policy if exists encuestas_ver on public.encuestas;
create policy encuestas_ver on public.encuestas for select
  using (public.mi_rol() = 'admin'
         or (public.mi_rol() = 'gestor' and municipio_id = public.mi_municipio())
         or (public.mi_rol() = 'encuestador' and creado_por = auth.uid()));

-- Encuestas: cargar (solo en el propio municipio, salvo el admin)
drop policy if exists encuestas_cargar on public.encuestas;
create policy encuestas_cargar on public.encuestas for insert
  with check (creado_por = auth.uid()
              and (public.mi_rol() = 'admin'
                   or (public.mi_rol() in ('gestor','encuestador') and municipio_id = public.mi_municipio())));

-- Encuestas: borrar (admin, o gestor de ese municipio)
drop policy if exists encuestas_borrar on public.encuestas;
create policy encuestas_borrar on public.encuestas for delete
  using (public.mi_rol() = 'admin'
         or (public.mi_rol() = 'gestor' and municipio_id = public.mi_municipio()));

-- ============================================================
-- DESPUÉS de crear tu propio usuario (ver la guía), convertilo en admin
-- reemplazando 'julian' por el usuario que elegiste:
--
--   update public.perfiles set rol = 'admin', nombre = 'Julián Rosonovich' where usuario = 'julian';
-- ============================================================
