import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Upload, FileCheck, AlertTriangle, Shield, MapPin,
  IndianRupee, Loader2, CheckCircle2, XCircle, Eye, Trash2,
  TrendingUp, FileText, Scale, ArrowUpRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AppLayout } from '@/components/AppLayout';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

const PROPERTY_TYPES = ['residential', 'commercial', 'industrial', 'agricultural'] as const;
const DOC_TYPES = [
  { key: 'property_deed', label: 'Property Deed / Sale Deed' },
  { key: 'registration_cert', label: 'Registration Certificate' },
  { key: 'encumbrance_cert', label: 'Encumbrance Certificate (EC)' },
  { key: 'valuation_report', label: 'Valuation Report' },
] as const;

interface PropertyData {
  id?: string;
  property_address: string;
  property_type: string;
  registration_number: string;
  owner_name: string;
  area_sqft: number | null;
  registered_value: number | null;
  assessed_value: number | null;
  market_value: number | null;
  ltv_ratio: number | null;
  encumbrances: string;
  ec_status: string;
  ec_number: string;
  verification_status: string;
  ocr_confidence: number | null;
  liens: LienData[];
  fraud_flags: FraudFlag[];
}

interface LienData {
  lien_type: string;
  lien_holder: string;
  amount: number;
  status: string;
  priority_order?: number;
}

interface FraudFlag {
  flag: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

interface UploadedDoc {
  file: File;
  type: string;
  status: 'pending' | 'uploading' | 'analyzing' | 'done' | 'error';
  result?: PropertyData;
  error?: string;
}

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

const stagger = { show: { transition: { staggerChildren: 0.08 } } };

const formatCurrency = (val: number | null) => {
  if (!val) return '—';
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(2)} L`;
  return `₹${val.toLocaleString('en-IN')}`;
};

export default function CollateralAssessment() {
  const [searchParams] = useSearchParams();
  const assessmentId = searchParams.get('assessment_id');
  const { toast } = useToast();
  const { user } = useAuth();

  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [properties, setProperties] = useState<PropertyData[]>([]);
  const [savedProperties, setSavedProperties] = useState<any[]>([]);
  const [loanAmount, setLoanAmount] = useState<number>(0);
  const [activeTab, setActiveTab] = useState('upload');
  const [isProcessing, setIsProcessing] = useState(false);

  // Fetch existing properties for assessment
  useEffect(() => {
    if (!assessmentId) return;
    const fetchData = async () => {
      const { data: assessment } = await supabase
        .from('assessments')
        .select('loan_requested')
        .eq('id', assessmentId)
        .single();
      if (assessment?.loan_requested) setLoanAmount(Number(assessment.loan_requested));

      const { data: props } = await supabase
        .from('collateral_properties')
        .select('*')
        .eq('assessment_id', assessmentId);
      if (props) setSavedProperties(props);
    };
    fetchData();
  }, [assessmentId]);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
  }, []);

  const addFiles = (files: File[]) => {
    const newDocs: UploadedDoc[] = files
      .filter(f => f.type.startsWith('image/') || f.type === 'application/pdf')
      .map(f => ({ file: f, type: 'property_deed', status: 'pending' as const }));
    setDocuments(prev => [...prev, ...newDocs]);
  };

  const removeDoc = (idx: number) => {
    setDocuments(prev => prev.filter((_, i) => i !== idx));
  };

  const setDocType = (idx: number, type: string) => {
    setDocuments(prev => prev.map((d, i) => i === idx ? { ...d, type } : d));
  };

  const analyzeDocuments = async () => {
    if (!assessmentId) {
      toast({ title: 'Error', description: 'No assessment selected.', variant: 'destructive' });
      return;
    }
    setIsProcessing(true);

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      if (doc.status === 'done') continue;

      setDocuments(prev => prev.map((d, idx) => idx === i ? { ...d, status: 'uploading' } : d));

      try {
        // Convert file to base64
        const base64 = await fileToBase64(doc.file);

        setDocuments(prev => prev.map((d, idx) => idx === i ? { ...d, status: 'analyzing' } : d));

        // Call edge function
        const { data: sessionData } = await supabase.auth.getSession();
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-property-details`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${sessionData?.session?.access_token}`,
            },
            body: JSON.stringify({
              document_base64: base64,
              document_type: doc.type,
              assessment_id: assessmentId,
            }),
          }
        );

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Analysis failed');
        }

        const result = await response.json();

        const propertyData: PropertyData = {
          property_address: result.data.property_address || '',
          property_type: result.data.property_type || 'residential',
          registration_number: result.data.registration_number || '',
          owner_name: result.data.owner_name || '',
          area_sqft: result.data.area_sqft,
          registered_value: result.data.registered_value,
          assessed_value: result.data.assessed_value || result.data.market_value,
          market_value: result.data.market_value,
          ltv_ratio: result.data.ltv_ratio,
          encumbrances: result.data.encumbrances || 'None',
          ec_status: result.data.ec_status || 'pending',
          ec_number: '',
          verification_status: 'pending',
          ocr_confidence: result.data.confidence_score,
          liens: result.data.liens || [],
          fraud_flags: result.data.fraud_flags || [],
        };

        setDocuments(prev => prev.map((d, idx) => idx === i ? { ...d, status: 'done', result: propertyData } : d));
        setProperties(prev => [...prev, propertyData]);
      } catch (err: any) {
        setDocuments(prev => prev.map((d, idx) => idx === i ? { ...d, status: 'error', error: err.message } : d));
      }
    }

    setIsProcessing(false);
    setActiveTab('properties');
    toast({ title: 'Analysis Complete', description: 'Property documents have been processed.' });
  };

  const saveProperty = async (property: PropertyData) => {
    if (!assessmentId) return;

    const { data, error } = await supabase.from('collateral_properties').insert({
      assessment_id: assessmentId,
      property_address: property.property_address,
      property_type: property.property_type,
      registration_number: property.registration_number,
      owner_name: property.owner_name,
      area_sqft: property.area_sqft,
      registered_value: property.registered_value,
      assessed_value: property.assessed_value,
      market_value: property.market_value,
      ltv_ratio: property.ltv_ratio,
      encumbrances: property.encumbrances,
      ec_status: property.ec_status,
      ec_number: property.ec_number,
      verification_status: 'verified',
      ocr_confidence: property.ocr_confidence,
      ocr_raw_data: property as any,
    }).select().single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }

    if (data && property.liens.length > 0) {
      for (const lien of property.liens) {
        await supabase.from('collateral_liens').insert({
          property_id: data.id,
          lien_type: lien.lien_type,
          lien_holder: lien.lien_holder,
          amount: lien.amount,
          priority_order: lien.priority_order || 1,
          status: lien.status,
        });
      }
    }

    setSavedProperties(prev => [...prev, data]);
    toast({ title: 'Property Saved', description: 'Collateral property verified and saved.' });
  };

  const totalCollateralValue = [...savedProperties, ...properties].reduce(
    (sum, p) => sum + Number(p.assessed_value || p.market_value || 0), 0
  );
  const coverageRatio = loanAmount > 0 ? totalCollateralValue / loanAmount : 0;
  const overallLTV = loanAmount > 0 ? (loanAmount / totalCollateralValue) * 100 : 0;

  const allFraudFlags = properties.flatMap(p => p.fraud_flags || []);

  return (
    <AppLayout>
      <motion.div
        initial="hidden" animate="show" variants={stagger}
        className="space-y-6 max-w-7xl mx-auto"
      >
        {/* Header */}
        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              Collateral Security Assessment
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Property verification, valuation & lien analysis
            </p>
          </div>
          {assessmentId && (
            <Badge variant="outline" className="border-primary/30 text-primary">
              Assessment: {assessmentId.slice(0, 8)}...
            </Badge>
          )}
        </motion.div>

        {/* KPI Cards */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-border/50 bg-card/80 backdrop-blur">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Total Collateral</p>
                  <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(totalCollateralValue)}</p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <IndianRupee className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/80 backdrop-blur">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Coverage Ratio</p>
                  <p className={cn("text-xl font-bold mt-1", coverageRatio >= 1.2 ? "text-[hsl(var(--cam-success))]" : "text-destructive")}>
                    {coverageRatio.toFixed(2)}x
                  </p>
                </div>
                <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center",
                  coverageRatio >= 1.2 ? "bg-[hsl(var(--cam-success))]/10" : "bg-destructive/10"
                )}>
                  <Scale className="h-5 w-5" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Min required: 1.2x</p>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/80 backdrop-blur">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">LTV Ratio</p>
                  <p className={cn("text-xl font-bold mt-1",
                    overallLTV <= 60 ? "text-[hsl(var(--cam-success))]" :
                    overallLTV <= 80 ? "text-[hsl(var(--cam-warning))]" : "text-destructive"
                  )}>
                    {isFinite(overallLTV) ? `${overallLTV.toFixed(1)}%` : '—'}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-lg bg-[hsl(var(--cam-warning))]/10 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-[hsl(var(--cam-warning))]" />
                </div>
              </div>
              <Progress value={Math.min(overallLTV, 100)} className="h-1.5 mt-2" />
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/80 backdrop-blur">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Fraud Flags</p>
                  <p className={cn("text-xl font-bold mt-1",
                    allFraudFlags.length === 0 ? "text-[hsl(var(--cam-success))]" : "text-destructive"
                  )}>
                    {allFraudFlags.length}
                  </p>
                </div>
                <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center",
                  allFraudFlags.length === 0 ? "bg-[hsl(var(--cam-success))]/10" : "bg-destructive/10"
                )}>
                  <AlertTriangle className={cn("h-5 w-5",
                    allFraudFlags.length === 0 ? "text-[hsl(var(--cam-success))]" : "text-destructive"
                  )} />
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Main Content */}
        <motion.div variants={fadeUp}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="bg-secondary/50 border border-border/50 p-1">
              <TabsTrigger value="upload" className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
                <Upload className="h-4 w-4 mr-2" />
                Upload Documents
              </TabsTrigger>
              <TabsTrigger value="properties" className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
                <Building2 className="h-4 w-4 mr-2" />
                Properties ({properties.length + savedProperties.length})
              </TabsTrigger>
              <TabsTrigger value="fraud" className="data-[state=active]:bg-primary/15 data-[state=active]:text-primary">
                <AlertTriangle className="h-4 w-4 mr-2" />
                Fraud Analysis
              </TabsTrigger>
            </TabsList>

            {/* Upload Tab */}
            <TabsContent value="upload" className="space-y-4">
              <Card className="border-border/50 bg-card/80 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-base">Property Document Upload</CardTitle>
                  <CardDescription>Upload property deeds, registration certificates, and encumbrance certificates for AI analysis</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Drop Zone */}
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleFileDrop}
                    className="border-2 border-dashed border-border/60 hover:border-primary/40 rounded-xl p-8 text-center transition-colors cursor-pointer"
                    onClick={() => document.getElementById('prop-file-input')?.click()}
                  >
                    <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm font-medium text-foreground">Drop property documents here</p>
                    <p className="text-xs text-muted-foreground mt-1">Supports PDF, JPG, PNG • Max 20MB each</p>
                    <input
                      id="prop-file-input"
                      type="file"
                      className="hidden"
                      multiple
                      accept="image/*,application/pdf"
                      onChange={handleFileInput}
                    />
                  </div>

                  {/* Document List */}
                  <AnimatePresence>
                    {documents.map((doc, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-secondary/30"
                      >
                        <FileText className="h-5 w-5 text-primary shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{doc.file.name}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {(doc.file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>
                        <Select value={doc.type} onValueChange={v => setDocType(idx, v)}>
                          <SelectTrigger className="w-48 h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DOC_TYPES.map(t => (
                              <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <StatusIcon status={doc.status} />
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => removeDoc(idx)}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  {documents.length > 0 && (
                    <Button
                      onClick={analyzeDocuments}
                      disabled={isProcessing || documents.every(d => d.status === 'done')}
                      className="w-full"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Analyzing Documents...
                        </>
                      ) : (
                        <>
                          <Shield className="h-4 w-4 mr-2" />
                          Analyze & Extract Property Details
                        </>
                      )}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Properties Tab */}
            <TabsContent value="properties" className="space-y-4">
              {/* Saved Properties */}
              {savedProperties.length > 0 && (
                <Card className="border-border/50 bg-card/80 backdrop-blur">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[hsl(var(--cam-success))]" />
                      Verified Properties
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border/30">
                          <TableHead className="text-[10px] uppercase tracking-wider">Address</TableHead>
                          <TableHead className="text-[10px] uppercase tracking-wider">Type</TableHead>
                          <TableHead className="text-[10px] uppercase tracking-wider">Area</TableHead>
                          <TableHead className="text-[10px] uppercase tracking-wider">Assessed Value</TableHead>
                          <TableHead className="text-[10px] uppercase tracking-wider">EC Status</TableHead>
                          <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {savedProperties.map((p: any) => (
                          <TableRow key={p.id} className="border-border/20">
                            <TableCell className="text-sm">
                              <div className="flex items-center gap-2">
                                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="truncate max-w-[200px]">{p.property_address || '—'}</span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] capitalize">{p.property_type}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">{p.area_sqft ? `${Number(p.area_sqft).toLocaleString()} sq.ft` : '—'}</TableCell>
                            <TableCell className="text-sm font-medium">{formatCurrency(Number(p.assessed_value))}</TableCell>
                            <TableCell>
                              <ECStatusBadge status={p.ec_status} />
                            </TableCell>
                            <TableCell>
                              <VerificationBadge status={p.verification_status} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}

              {/* Extracted Properties (pending save) */}
              {properties.map((property, idx) => (
                <motion.div key={idx} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
                  <Card className="border-border/50 bg-card/80 backdrop-blur overflow-hidden">
                    <CardHeader className="border-b border-border/30">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-primary" />
                            {property.property_address || 'Extracted Property'}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            OCR Confidence: {property.ocr_confidence ? `${property.ocr_confidence}%` : '—'}
                          </CardDescription>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline" className="capitalize text-[10px]">{property.property_type}</Badge>
                          <Badge variant="outline" className="text-[10px]">{property.verification_status}</Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-4 space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <InfoField label="Owner" value={property.owner_name} />
                        <InfoField label="Registration #" value={property.registration_number} />
                        <InfoField label="Area" value={property.area_sqft ? `${property.area_sqft.toLocaleString()} sq.ft` : null} />
                        <InfoField label="EC Status" value={property.ec_status} />
                        <InfoField label="Registered Value" value={formatCurrency(property.registered_value)} />
                        <InfoField label="Assessed Value" value={formatCurrency(property.assessed_value)} />
                        <InfoField label="Market Value" value={formatCurrency(property.market_value)} />
                        <InfoField label="LTV Ratio" value={property.ltv_ratio ? `${property.ltv_ratio.toFixed(1)}%` : null} highlight={property.ltv_ratio && property.ltv_ratio > 80} />
                      </div>

                      {/* Liens */}
                      {property.liens && property.liens.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Liens & Encumbrances</p>
                          <div className="rounded-lg border border-border/40 overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow className="border-border/30 bg-secondary/20">
                                  <TableHead className="text-[10px] uppercase">Type</TableHead>
                                  <TableHead className="text-[10px] uppercase">Holder</TableHead>
                                  <TableHead className="text-[10px] uppercase">Amount</TableHead>
                                  <TableHead className="text-[10px] uppercase">Status</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {property.liens.map((lien, lIdx) => (
                                  <TableRow key={lIdx} className="border-border/20">
                                    <TableCell className="text-xs capitalize">{lien.lien_type}</TableCell>
                                    <TableCell className="text-xs">{lien.lien_holder}</TableCell>
                                    <TableCell className="text-xs font-medium">{formatCurrency(lien.amount)}</TableCell>
                                    <TableCell>
                                      <Badge
                                        variant="outline"
                                        className={cn("text-[10px] capitalize",
                                          lien.status === 'active' ? 'border-destructive/30 text-destructive' : 'border-[hsl(var(--cam-success))]/30 text-[hsl(var(--cam-success))]'
                                        )}
                                      >
                                        {lien.status}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}

                      {/* Fraud Flags */}
                      {property.fraud_flags && property.fraud_flags.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wider text-destructive">⚠ Fraud Flags</p>
                          <div className="space-y-1.5">
                            {property.fraud_flags.map((flag, fIdx) => (
                              <div key={fIdx} className={cn(
                                "flex items-center gap-2 px-3 py-2 rounded-md text-xs",
                                flag.severity === 'HIGH' ? 'bg-destructive/10 text-destructive border border-destructive/20' :
                                flag.severity === 'MEDIUM' ? 'bg-[hsl(var(--cam-warning))]/10 text-[hsl(var(--cam-warning))] border border-[hsl(var(--cam-warning))]/20' :
                                'bg-muted text-muted-foreground border border-border/30'
                              )}>
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                <span className="flex-1">{flag.flag}</span>
                                <Badge variant="outline" className="text-[9px] uppercase">{flag.severity}</Badge>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex justify-end gap-2 pt-2 border-t border-border/30">
                        <Button variant="outline" size="sm">
                          <Eye className="h-3.5 w-3.5 mr-1.5" /> Review
                        </Button>
                        <Button size="sm" onClick={() => saveProperty(property)}>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Verify & Save
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}

              {properties.length === 0 && savedProperties.length === 0 && (
                <Card className="border-border/50 bg-card/80 backdrop-blur">
                  <CardContent className="p-12 text-center">
                    <Building2 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No properties added yet</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Upload property documents to begin analysis</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Fraud Analysis Tab */}
            <TabsContent value="fraud" className="space-y-4">
              <Card className="border-border/50 bg-card/80 backdrop-blur">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary" />
                    Collateral Fraud Analysis
                  </CardTitle>
                  <CardDescription>AI-detected risk indicators from property documents</CardDescription>
                </CardHeader>
                <CardContent>
                  {allFraudFlags.length > 0 ? (
                    <div className="space-y-2">
                      {allFraudFlags.map((flag, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, x: 8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-lg border text-sm",
                            flag.severity === 'HIGH' ? 'bg-destructive/5 border-destructive/20 text-destructive' :
                            flag.severity === 'MEDIUM' ? 'bg-[hsl(var(--cam-warning))]/5 border-[hsl(var(--cam-warning))]/20 text-[hsl(var(--cam-warning))]' :
                            'bg-muted/50 border-border/30 text-muted-foreground'
                          )}
                        >
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <span className="flex-1">{flag.flag}</span>
                          <Badge variant={flag.severity === 'HIGH' ? 'destructive' : 'outline'} className="text-[10px]">
                            {flag.severity}
                          </Badge>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <CheckCircle2 className="h-10 w-10 text-[hsl(var(--cam-success))]/40 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No fraud flags detected</p>
                    </div>
                  )}

                  {/* Covenant Clause */}
                  <div className="mt-6 p-4 rounded-lg border border-primary/20 bg-primary/5">
                    <div className="flex items-start gap-3">
                      <Shield className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-foreground">Covenant Clause</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Bank has first lien on the property. Minimum collateral coverage must be maintained at 1.2x the loan amount at all times.
                          Borrower shall not create any further charge or encumbrance on the property without prior written consent of the Bank.
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </motion.div>
      </motion.div>
    </AppLayout>
  );
}

// Helper Components
function StatusIcon({ status }: { status: UploadedDoc['status'] }) {
  switch (status) {
    case 'uploading': return <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />;
    case 'analyzing': return <Loader2 className="h-4 w-4 text-[hsl(var(--cam-warning))] animate-spin shrink-0" />;
    case 'done': return <CheckCircle2 className="h-4 w-4 text-[hsl(var(--cam-success))] shrink-0" />;
    case 'error': return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
    default: return <FileCheck className="h-4 w-4 text-muted-foreground shrink-0" />;
  }
}

function ECStatusBadge({ status }: { status: string }) {
  const config: Record<string, string> = {
    clear: 'bg-[hsl(var(--cam-success))]/10 text-[hsl(var(--cam-success))] border-[hsl(var(--cam-success))]/20',
    encumbered: 'bg-destructive/10 text-destructive border-destructive/20',
    pending: 'bg-[hsl(var(--cam-warning))]/10 text-[hsl(var(--cam-warning))] border-[hsl(var(--cam-warning))]/20',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px] capitalize', config[status] || config.pending)}>
      {status}
    </Badge>
  );
}

function VerificationBadge({ status }: { status: string }) {
  const isVerified = status === 'verified';
  return (
    <Badge variant="outline" className={cn('text-[10px] capitalize',
      isVerified ? 'bg-[hsl(var(--cam-success))]/10 text-[hsl(var(--cam-success))] border-[hsl(var(--cam-success))]/20' :
      'bg-[hsl(var(--cam-warning))]/10 text-[hsl(var(--cam-warning))] border-[hsl(var(--cam-warning))]/20'
    )}>
      {isVerified && <CheckCircle2 className="h-3 w-3 mr-1" />}
      {status}
    </Badge>
  );
}

function InfoField({ label, value, highlight }: { label: string; value: string | null; highlight?: boolean | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className={cn("text-sm font-medium mt-0.5", highlight ? 'text-destructive' : 'text-foreground')}>
        {value || '—'}
      </p>
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
