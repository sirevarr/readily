-- =====================================================
-- Readily — Migración completa
-- Ejecuta esto en Supabase > SQL Editor
-- Es seguro ejecutarlo varias veces (IF NOT EXISTS)
-- =====================================================

-- ---- 1. Tabla de progreso de lectura ----
CREATE TABLE IF NOT EXISTS reading_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid,
  page int NOT NULL DEFAULT 1,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(document_id, user_id)
);
ALTER TABLE reading_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own progress" ON reading_progress;
CREATE POLICY "own progress" ON reading_progress USING (auth.uid() = user_id);

-- Añadir user_id si no existe
ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS user_id uuid;

-- ---- 2. Tabla de documentos — columna category ----
ALTER TABLE documents ADD COLUMN IF NOT EXISTS category text DEFAULT 'Sin categoría';

-- ---- 3. Tabla de subrayados ----
CREATE TABLE IF NOT EXISTS highlights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid,
  page int NOT NULL,
  rects jsonb,
  color text,
  text text,
  note text DEFAULT '',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE highlights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own highlights" ON highlights;
CREATE POLICY "own highlights" ON highlights USING (auth.uid() = user_id);

-- ---- 4. Tabla de flashcards ----
CREATE TABLE IF NOT EXISTS flashcards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid,
  front text NOT NULL,
  back text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own flashcards" ON flashcards;
CREATE POLICY "own flashcards" ON flashcards USING (auth.uid() = user_id);

-- ---- 5. Tabla de threads de chat ----
CREATE TABLE IF NOT EXISTS chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid,
  title text NOT NULL DEFAULT 'Chat General',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own threads" ON chat_threads;
CREATE POLICY "own threads" ON chat_threads USING (auth.uid() = user_id);

-- ---- 6. Tabla de mensajes de chat ----
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id uuid,
  role text NOT NULL CHECK (role IN ('user','model')),
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own messages" ON chat_messages;
CREATE POLICY "own messages" ON chat_messages USING (auth.uid() = user_id);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES chat_threads(id) ON DELETE CASCADE;

-- ---- 7. Tabla de glosario ----
CREATE TABLE IF NOT EXISTS glossary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid,
  term text NOT NULL,
  definition text NOT NULL,
  context_definition text DEFAULT '',
  level text DEFAULT 'intermedio' CHECK (level IN ('simple','intermedio','tecnico')),
  page int,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE glossary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own glossary" ON glossary;
CREATE POLICY "own glossary" ON glossary USING (auth.uid() = user_id);
ALTER TABLE glossary ADD COLUMN IF NOT EXISTS context_definition text DEFAULT '';

-- ---- 8. Tabla de racha diaria (NUEVO v2) ----
CREATE TABLE IF NOT EXISTS reading_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  day text NOT NULL, -- formato 'YYYY-MM-DD'
  pages int DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, day)
);
ALTER TABLE reading_days ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own reading_days" ON reading_days;
CREATE POLICY "own reading_days" ON reading_days USING (auth.uid() = user_id);

-- ---- 9. Tabla de intentos de quiz (NUEVO v2) ----
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  from_page int NOT NULL,
  to_page int NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  feedback text DEFAULT '',
  score int DEFAULT 100,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own quiz_attempts" ON quiz_attempts;
CREATE POLICY "own quiz_attempts" ON quiz_attempts USING (auth.uid() = user_id);

-- Alteraciones adicionales de compatibilidad
ALTER TABLE reading_progress ADD COLUMN IF NOT EXISTS max_page int DEFAULT 1;

-- ---- 10. Storage bucket (ejecutar si no existe) ----
-- Nota: esto puede fallar si ya existe — es normal
INSERT INTO storage.buckets (id, name, public)
VALUES ('pdfs', 'pdfs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "upload pdfs" ON storage.objects;
DROP POLICY IF EXISTS "download pdfs" ON storage.objects;
DROP POLICY IF EXISTS "delete pdfs" ON storage.objects;

CREATE POLICY "upload pdfs" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "download pdfs" ON storage.objects
  FOR SELECT USING (bucket_id = 'pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "delete pdfs" ON storage.objects
  FOR DELETE USING (bucket_id = 'pdfs' AND auth.uid()::text = (storage.foldername(name))[1]);

