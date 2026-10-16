-- PROFILE AVATAR (UI refinement 2026-10-16; owner: "it should the player's chosen profile pic, not their most played hero
-- here. same with the career page, the chosen profile art should be displayed").
--
-- The chosen profile picture (the avatar picker's id, e.g. a hero or minion art key) lived only in the player's browser
-- (localStorage 'ascent.avatar'), so nobody else could ever see it. This adds ONE nullable display column on `profiles`,
-- written by its owner like `author` (the existing row policies already let a player update their own display columns;
-- the rating / rank checks are untouched), and read with the ladder rows (Leaderboard, Career header).
--
-- Safe to run more than once. Until it runs, the client reads without the column and shows the favourite hero instead.
alter table public.profiles add column if not exists avatar text;
alter table public.profiles drop constraint if exists profiles_avatar_len;
alter table public.profiles add constraint profiles_avatar_len check (avatar is null or char_length(avatar) <= 64);
