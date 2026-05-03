
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  carrier TEXT NOT NULL CHECK (carrier IN ('claro', 'vivo', 'tim')),
  phone TEXT NOT NULL,
  recharge_amount NUMERIC(10,2) NOT NULL,
  paid_amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'cancelled', 'refunded', 'fulfilled')),
  pixgo_payment_id TEXT UNIQUE,
  qr_code TEXT,
  qr_image_url TEXT,
  expires_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- Public app: anyone can read their own order by id (no login)
CREATE POLICY "Anyone can read orders" ON public.orders FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_pixgo_payment_id ON public.orders(pixgo_payment_id);
