import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { document_base64, document_type, assessment_id } = await req.json();

    if (!document_base64 || !assessment_id) {
      return new Response(JSON.stringify({ error: "document_base64 and assessment_id are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `You are an expert Indian property document analyzer for bank credit appraisal. 
Extract structured property information from the uploaded document image.
Return ONLY a valid JSON object with these fields:
{
  "property_address": "full address string",
  "property_type": "residential" | "commercial" | "industrial" | "agricultural",
  "registration_number": "registration/deed number",
  "owner_name": "property owner name",
  "area_sqft": number (area in square feet),
  "registered_value": number (in INR),
  "market_value": number (estimated market value in INR),
  "registration_date": "YYYY-MM-DD or null",
  "encumbrances": "description of any encumbrances or 'None'",
  "ec_status": "clear" | "encumbered" | "pending",
  "liens": [
    { "lien_type": "mortgage/charge/lien", "lien_holder": "name", "amount": number, "status": "active/released" }
  ],
  "fraud_flags": [
    { "flag": "description of concern", "severity": "HIGH" | "MEDIUM" | "LOW" }
  ],
  "confidence_score": number (0-100),
  "document_type_detected": "property_deed" | "registration_certificate" | "encumbrance_certificate" | "other"
}
If any field cannot be determined, use null. Always check for:
- Owner name mismatch indicators
- Multiple liens or encumbrances
- Recent registration dates (potential flip risk)
- Overvaluation indicators`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this ${document_type || "property"} document and extract all property details. Document type: ${document_type || "unknown"}.`,
              },
              {
                type: "image_url",
                image_url: { url: `data:image/png;base64,${document_base64}` },
              },
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      throw new Error("AI analysis failed");
    }

    const aiData = await aiResponse.json();
    const content = aiData.choices?.[0]?.message?.content || "";

    // Parse JSON from AI response
    let extracted;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      extracted = null;
    }

    if (!extracted) {
      return new Response(JSON.stringify({ error: "Could not extract property details from document" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate LTV if we have values
    let ltv_ratio = null;
    const { data: assessment } = await supabase
      .from("assessments")
      .select("loan_requested")
      .eq("id", assessment_id)
      .single();

    if (assessment?.loan_requested && extracted.assessed_value || extracted.market_value) {
      const collateralValue = extracted.assessed_value || extracted.market_value || extracted.registered_value;
      if (collateralValue > 0) {
        ltv_ratio = (Number(assessment.loan_requested) / collateralValue) * 100;
      }
    }

    // Check for fraud flags
    const fraudFlags = extracted.fraud_flags || [];
    if (ltv_ratio && ltv_ratio > 80) {
      fraudFlags.push({ flag: "High LTV ratio (>80%)", severity: "HIGH" });
    }
    if (extracted.liens && extracted.liens.filter((l: any) => l.status === "active").length > 1) {
      fraudFlags.push({ flag: "Multiple active liens on property", severity: "HIGH" });
    }

    return new Response(JSON.stringify({
      success: true,
      data: {
        ...extracted,
        ltv_ratio,
        fraud_flags: fraudFlags,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-property-details error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
