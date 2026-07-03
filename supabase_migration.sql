-- =============================================================
-- Readily — SQL de actualización
-- Ejecuta esto en Supabase → SQL Editor → New query → Run
-- =============================================================

-- 1. Tabla de hilos de conversación (múltiples chats por documento)
create table if not exists chat_threads (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users not null default auth.uid(),
  document_id  uuid references documents(id) on delete cascade not null,
  title        text not null default 'Chat General',
  created_at   timestamptz default now()
);

alter table chat_threads enable row level security;

create policy "users own chat_threads" on chat_threads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Añadir thread_id a chat_messages (si ya existe la tabla)
alter table chat_messages
  add column if not exists thread_id uuid references chat_threads(id) on delete cascade;

-- 3. Tabla de flashcards
create table if not exists flashcards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users not null default auth.uid(),
  document_id  uuid references documents(id) on delete cascade not null,
  front        text not null,  -- El término
  back         text not null,  -- JSON con la explicación estructurada
  created_at   timestamptz default now()
);

alter table flashcards enable row level security;

create policy "users own flashcards" on flashcards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4. Índice de rendimiento (opcional pero recomendado)
create index if not exists chat_messages_thread_id_idx on chat_messages(thread_id);
create index if not exists flashcards_document_id_idx  on flashcards(document_id);
