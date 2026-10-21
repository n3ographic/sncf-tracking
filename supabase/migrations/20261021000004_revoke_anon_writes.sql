-- Droits d'écriture retirés aux rôles clients (anon, authenticated) sur tout le schéma public.
-- Supabase leur accorde par défaut INSERT/UPDATE/DELETE/TRUNCATE : seule la RLS les bloquait,
-- et la RLS ne couvre pas TRUNCATE. Le collecteur écrit en service_role, non concerné.
-- SELECT n'est pas touché : la lecture publique reste régie par les politiques RLS existantes.

-- Tables et vues existantes (« all tables » couvre aussi la vue circulation_measures).
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;

-- Tables créées plus tard par le rôle qui applique les migrations.
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;
