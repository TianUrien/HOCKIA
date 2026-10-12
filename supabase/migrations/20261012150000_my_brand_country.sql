-- get_my_brand returns country_id, so the brand's own page and edit screen
-- show the country (Profile v2 hero, Brand edit · Country). Same signature
-- and grants (CREATE OR REPLACE keeps the ACL).
CREATE OR REPLACE FUNCTION public.get_my_brand()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    SELECT row_to_json(b)
    FROM (
      SELECT br.id, br.profile_id, br.slug, br.name, br.logo_url, br.cover_url, br.open_to_partners, br.bio,
             br.website_url, br.instagram_url, br.category, br.country_id,
             COALESCE(p.is_verified, false) AS is_verified,
             br.created_at, br.updated_at
      FROM public.brands br
      LEFT JOIN profiles p ON p.id = br.profile_id
      WHERE br.profile_id = auth.uid() AND br.deleted_at IS NULL
    ) b
  );
END;
$function$;
