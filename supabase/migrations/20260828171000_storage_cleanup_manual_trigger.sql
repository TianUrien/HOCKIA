-- Allow the service role to trigger the nightly cleanup by hand
-- (verification after deploy, and ad-hoc drains). Members still cannot.
GRANT EXECUTE ON FUNCTION public.run_storage_cleanup() TO service_role;
