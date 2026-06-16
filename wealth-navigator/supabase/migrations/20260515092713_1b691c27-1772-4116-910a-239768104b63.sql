CREATE TABLE public.monthly_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month text NOT NULL,
  assets numeric(14,2) NOT NULL DEFAULT 0,
  liabilities numeric(14,2) NOT NULL DEFAULT 0,
  net_worth numeric(14,2) NOT NULL DEFAULT 0,
  savings numeric(14,2) NOT NULL DEFAULT 0,
  portfolio_value numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, month)
);

ALTER TABLE public.monthly_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Snapshots: view own" ON public.monthly_snapshots FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Snapshots: insert own" ON public.monthly_snapshots FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Snapshots: update own" ON public.monthly_snapshots FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Snapshots: delete own" ON public.monthly_snapshots FOR DELETE TO authenticated USING (auth.uid() = user_id);