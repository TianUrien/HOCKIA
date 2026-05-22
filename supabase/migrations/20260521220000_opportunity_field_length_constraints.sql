-- Server-side length caps for opportunity title / description.
--
-- The Create Opportunity form caps title at 120 and description at 2000
-- via the inputs' maxLength, but that is client-only — a paste/IME edge
-- case or a scripted client can write past it. These CHECK constraints
-- enforce the same limits at the database for every write path.
--
-- Added NOT VALID: the constraints enforce all new INSERT/UPDATEs but do
-- not retro-validate existing rows, so the migration can't fail on a
-- legacy over-length row. (Staging is already clean — longest title is
-- 86 chars — but NOT VALID keeps this safe on production too.)

ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_title_length;
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_title_length
  CHECK (char_length(title) <= 120) NOT VALID;

ALTER TABLE public.opportunities DROP CONSTRAINT IF EXISTS opportunities_description_length;
ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_description_length
  CHECK (description IS NULL OR char_length(description) <= 2000) NOT VALID;
