
-- Table: collateral_properties
CREATE TABLE public.collateral_properties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  assessment_id UUID NOT NULL REFERENCES public.assessments(id) ON DELETE CASCADE,
  property_address TEXT,
  property_type TEXT DEFAULT 'residential',
  registration_number TEXT,
  owner_name TEXT,
  area_sqft NUMERIC,
  registered_value NUMERIC,
  assessed_value NUMERIC,
  market_value NUMERIC,
  ltv_ratio NUMERIC,
  encumbrances TEXT,
  ec_status TEXT DEFAULT 'pending',
  ec_number TEXT,
  ec_date DATE,
  verification_status TEXT DEFAULT 'pending',
  ocr_confidence NUMERIC,
  ocr_raw_data JSONB,
  document_path TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table: collateral_liens
CREATE TABLE public.collateral_liens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.collateral_properties(id) ON DELETE CASCADE,
  lien_type TEXT,
  lien_holder TEXT,
  amount NUMERIC,
  priority_order INTEGER DEFAULT 1,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.collateral_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collateral_liens ENABLE ROW LEVEL SECURITY;

-- RLS for collateral_properties
CREATE POLICY "View collateral properties" ON public.collateral_properties
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.assessments a
  WHERE a.id = collateral_properties.assessment_id
  AND (a.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'branch_manager'))
));

CREATE POLICY "Insert collateral properties" ON public.collateral_properties
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.assessments a
  WHERE a.id = collateral_properties.assessment_id AND a.created_by = auth.uid()
));

CREATE POLICY "Update collateral properties" ON public.collateral_properties
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.assessments a
  WHERE a.id = collateral_properties.assessment_id
  AND (a.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'branch_manager'))
));

-- RLS for collateral_liens
CREATE POLICY "View collateral liens" ON public.collateral_liens
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.collateral_properties cp
  JOIN public.assessments a ON a.id = cp.assessment_id
  WHERE cp.id = collateral_liens.property_id
  AND (a.created_by = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'branch_manager'))
));

CREATE POLICY "Insert collateral liens" ON public.collateral_liens
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.collateral_properties cp
  JOIN public.assessments a ON a.id = cp.assessment_id
  WHERE cp.id = collateral_liens.property_id AND a.created_by = auth.uid()
));

-- Trigger for updated_at on collateral_properties
CREATE TRIGGER update_collateral_properties_updated_at
  BEFORE UPDATE ON public.collateral_properties
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
