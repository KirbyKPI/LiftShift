-- Auto-create a training_coaches row when a new user signs up.
-- The display_name comes from raw_user_meta_data set during signUp().
-- Runs as SECURITY DEFINER so it bypasses RLS on training_coaches.

CREATE OR REPLACE FUNCTION public.handle_new_coach_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO training_coaches (user_id, display_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'Coach'),
    NEW.email
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_coach_signup();
