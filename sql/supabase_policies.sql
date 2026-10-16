-- supabase_policies.sql
-- Run these in your Supabase SQL editor to enable RLS and allow the demo to function quickly.
-- WARNING: These policies are permissive and intended for development/testing only.

-- Enable RLS on the main tables
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;

-- Permissive policies (development only)
-- Games
CREATE POLICY games_public_select ON public.games FOR SELECT USING (true);
CREATE POLICY games_public_insert ON public.games FOR INSERT WITH CHECK (true);
CREATE POLICY games_public_update_any ON public.games FOR UPDATE USING (true) WITH CHECK (true);

-- Players
CREATE POLICY players_public_select ON public.players FOR SELECT USING (true);
CREATE POLICY players_public_insert ON public.players FOR INSERT WITH CHECK (true);
CREATE POLICY players_public_update_any ON public.players FOR UPDATE USING (true) WITH CHECK (true);

-- Rounds
CREATE POLICY rounds_public_select ON public.rounds FOR SELECT USING (true);
CREATE POLICY rounds_public_insert ON public.rounds FOR INSERT WITH CHECK (true);

-- Questions
CREATE POLICY questions_public_select ON public.questions FOR SELECT USING (true);
CREATE POLICY questions_public_insert ON public.questions FOR INSERT WITH CHECK (true);

-- Answers
CREATE POLICY answers_public_select ON public.answers FOR SELECT USING (true);
CREATE POLICY answers_public_insert ON public.answers FOR INSERT WITH CHECK (true);

-- Notes:
-- 1) These policies allow public read/write and are intentionally permissive so the client demo works without additional auth setup.
-- 2) For production, replace the update/insert policies with stricter checks that verify the caller's auth.uid() or a stored host_user/player_user mapping.
-- 3) Example stricter update policy for games (host-only update) requires storing host_user on games and using auth.uid():
--
-- CREATE POLICY games_host_update ON public.games
--   FOR UPDATE
--   USING ( host_user IS NOT NULL AND host_user = auth.uid() )
--   WITH CHECK ( host_user IS NOT NULL AND host_user = auth.uid() );
