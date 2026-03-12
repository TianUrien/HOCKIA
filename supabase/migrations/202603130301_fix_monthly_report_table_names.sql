-- No-op: interim hotfix that re-applied admin_get_monthly_report with corrected
-- table names (vacancies → opportunities, vacancy_applications → opportunity_applications).
-- The canonical definition lives in 202603130300_monthly_report_rpc.sql.
-- This file is kept because it was already applied to staging and production.
SELECT 1;
