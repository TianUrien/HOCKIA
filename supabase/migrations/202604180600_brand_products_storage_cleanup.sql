-- Enqueue brand-products bucket objects for cleanup on soft- and hard-delete.
--
-- Audit bug N2. `user_posts` and `brand_posts` already have queue triggers
-- (see 202602140300) that enqueue their media for the storage_cleanup_queue.
-- `brand_products` was missed. Without a queue, product images leak on:
--   - single product soft-delete (delete_brand_product RPC)
--   - brand soft-delete (cascades nothing here — but admin hard-deletes do)
--   - profile hard-delete (account deletion cascades via brands.profile_id)
--
-- The brand_products.images column is a JSONB array of { url, order } objects
-- (per useBrandProducts.ts::ProductImage). We iterate the array, extract the
-- `url` field from each object, derive the storage path via the existing
-- extract_storage_path helper, and enqueue.

SET search_path = public;

-- ============================================================================
-- Soft-delete trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.queue_brand_product_media_cleanup_on_soft_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket TEXT := 'brand-products';
  v_url    TEXT;
  v_path   TEXT;
BEGIN
  -- Only fire on transitions into soft-deleted state.
  IF NEW.deleted_at IS NULL OR OLD.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.images IS NULL OR jsonb_typeof(NEW.images) <> 'array' OR jsonb_array_length(NEW.images) = 0 THEN
    RETURN NEW;
  END IF;

  FOR v_url IN
    SELECT img->>'url'
    FROM jsonb_array_elements(NEW.images) AS img
    WHERE jsonb_typeof(img) = 'object' AND img->>'url' IS NOT NULL
  LOOP
    IF v_url IS NULL OR length(trim(v_url)) = 0 THEN
      CONTINUE;
    END IF;

    v_path := public.extract_storage_path(v_url, v_bucket);
    IF v_path IS NOT NULL THEN
      INSERT INTO public.storage_cleanup_queue (bucket_id, object_path, reason)
      VALUES (v_bucket, v_path, 'soft-deleted brand_product ' || NEW.id::TEXT)
      ON CONFLICT (bucket_id, object_path) WHERE processed_at IS NULL
        DO UPDATE SET reason     = EXCLUDED.reason,
                      queued_at  = timezone('utc', now()),
                      updated_at = timezone('utc', now());
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_queue_brand_product_media_cleanup ON public.brand_products;
CREATE TRIGGER trigger_queue_brand_product_media_cleanup
  AFTER UPDATE OF deleted_at ON public.brand_products
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_brand_product_media_cleanup_on_soft_delete();

-- ============================================================================
-- Hard-delete trigger (cascades from brands.profile_id → profiles hard delete)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.queue_brand_product_media_cleanup_on_hard_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket TEXT := 'brand-products';
  v_url    TEXT;
  v_path   TEXT;
BEGIN
  IF OLD.images IS NULL OR jsonb_typeof(OLD.images) <> 'array' OR jsonb_array_length(OLD.images) = 0 THEN
    RETURN OLD;
  END IF;

  FOR v_url IN
    SELECT img->>'url'
    FROM jsonb_array_elements(OLD.images) AS img
    WHERE jsonb_typeof(img) = 'object' AND img->>'url' IS NOT NULL
  LOOP
    IF v_url IS NULL OR length(trim(v_url)) = 0 THEN
      CONTINUE;
    END IF;

    v_path := public.extract_storage_path(v_url, v_bucket);
    IF v_path IS NOT NULL THEN
      INSERT INTO public.storage_cleanup_queue (bucket_id, object_path, reason)
      VALUES (v_bucket, v_path, 'hard-deleted brand_product ' || OLD.id::TEXT)
      ON CONFLICT (bucket_id, object_path) WHERE processed_at IS NULL
        DO UPDATE SET reason     = EXCLUDED.reason,
                      queued_at  = timezone('utc', now()),
                      updated_at = timezone('utc', now());
    END IF;
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trigger_queue_brand_product_media_cleanup_on_delete ON public.brand_products;
CREATE TRIGGER trigger_queue_brand_product_media_cleanup_on_delete
  BEFORE DELETE ON public.brand_products
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_brand_product_media_cleanup_on_hard_delete();

NOTIFY pgrst, 'reload schema';
