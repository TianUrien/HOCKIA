-- Rollback for 20261121100000_role_outcome_answers.sql: removes the table
-- with its policies, index and grants. The answers recorded in it are lost;
-- nothing else reads or depends on it.

DROP TABLE IF EXISTS public.role_outcome_answers;
