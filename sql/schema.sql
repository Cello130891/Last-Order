-- sql/schema.sql
-- Minimal schema for Last-Order multiplayer demo
-- Run this in your Supabase SQL editor to create the required tables.

CREATE TABLE public.games (
  id bigserial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  host_name text,
  host_user text,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.players (
  id bigserial PRIMARY KEY,
  game text NOT NULL,
  name text,
  is_host boolean DEFAULT false,
  client_id text,
  user_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.rounds (
  id bigserial PRIMARY KEY,
  game text NOT NULL,
  round_number int NOT NULL,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.questions (
  id bigserial PRIMARY KEY,
  game text NOT NULL,
  round_number int NOT NULL,
  type text NOT NULL,
  text text,
  options jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.answers (
  id bigserial PRIMARY KEY,
  game text NOT NULL,
  round_number int,
  question_id int,
  player_name text,
  client_id text,
  answer jsonb,
  created_at timestamptz DEFAULT now()
);

-- Indexes to speed lookups
CREATE INDEX IF NOT EXISTS idx_players_game ON public.players(game);
CREATE INDEX IF NOT EXISTS idx_rounds_game ON public.rounds(game);
CREATE INDEX IF NOT EXISTS idx_questions_game_round ON public.questions(game, round_number);
CREATE INDEX IF NOT EXISTS idx_answers_game_qid ON public.answers(game, question_id);
