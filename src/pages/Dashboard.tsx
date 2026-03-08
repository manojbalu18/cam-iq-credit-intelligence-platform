import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, AlertTriangle, TrendingDown, Clock, Plus, Loader2 } from 'lucide-react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AppLayout } from '@/components/AppLayout';
import { KPICard } from '@/components/KPICard';
import { StatusBadge } from '@/components/StatusBadge';
import { ScoreBadge } from '@/components/ScoreBadge';
import { formatINR } from '@/lib/format';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const PIE_COLORS = ['hsl(0,72%,51%)', 'hsl(32,95%,44%)', 'hsl(187,92%,37%)', 'hsl(270,50%,55%)', 'hsl(160,84%,39%)'];
const tooltipStyle = { background: 'hsl(222,25%,11%)', border: '1px solid hsl(222,15%,18%)', borderRadius: '6px', color: 'hsl(213,20%,88%)' };

interface DashboardAssessment {
  id: string;
  borrower_name: string;
  cin: string | null;
  sector: string | null;
  loan_requested: number | null;
  composite_score: number | null;
  status: string;
  created_at: string;
}

interface FraudAlert {
  id: string;
  fraud_type: string | null;
  severity: string | null;
  assessment_id: string;
  borrower_name?: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState<DashboardAssessment[]>([]);
  const [fraudAlerts, setFraudAlerts] = useState<FraudAlert[]>([]);
  const [flagCounts, setFlagCounts] = useState<Record<string, number>>({});
  const [totalFlags, setTotalFlags] = useState(0);

  useEffect(() => {
    if (!user) return;

    const fetchDashboard = async () => {
      setLoading(true);

      const [assessmentsRes, flagsRes] = await Promise.all([
        supabase
          .from('assessments')
          .select('id, borrower_name, cin, sector, loan_requested, composite_score, status, created_at')
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('fraud_flags')
          .select('id, fraud_type, severity, assessment_id')
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      const assessmentData = assessmentsRes.data || [];
      const flagsData = flagsRes.data || [];

      setAssessments(assessmentData);
      setTotalFlags(flagsData.length);

      // Enrich fraud alerts with borrower names
      const assessmentMap = new Map(assessmentData.map(a => [a.id, a.borrower_name]));
      const enrichedAlerts = flagsData.map(f => ({
        ...f,
        borrower_name: assessmentMap.get(f.assessment_id) || 'Unknown',
      }));
      setFraudAlerts(enrichedAlerts);

      // Count fraud types for pie chart
      const typeCounts: Record<string, number> = {};
      flagsData.forEach(f => {
        const type = f.fraud_type || 'Other';
        typeCounts[type] = (typeCounts[type] || 0) + 1;
      });
      setFlagCounts(typeCounts);

      setLoading(false);
    };

    fetchDashboard();
  }, [user]);

  const fraudTypesData = Object.entries(flagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value]) => ({ name, value }));

  const totalLoanRequested = assessments.reduce((sum, a) => sum + (a.loan_requested || 0), 0);

  // Build weekly CAM count from real data
  const weeklyData = (() => {
    const weeks: Record<string, number> = {};
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - i * 7);
      weeks[`W${8 - i}`] = 0;
    }
    assessments.forEach(a => {
      const created = new Date(a.created_at);
      const weeksAgo = Math.floor((now.getTime() - created.getTime()) / (7 * 24 * 60 * 60 * 1000));
      const weekKey = `W${Math.max(1, 8 - weeksAgo)}`;
      if (weeks[weekKey] !== undefined) weeks[weekKey]++;
    });
    return Object.entries(weeks).map(([week, cams]) => ({ week, cams }));
  })();

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64 gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="text-muted-foreground">Loading dashboard...</span>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title="CAMs This Month" value={String(assessments.length)} icon={FileText} color="teal" />
          <KPICard title="Active Fraud Flags" value={String(totalFlags)} icon={AlertTriangle} color="red" pulse={totalFlags > 0} />
          <KPICard title="Total Loan Requested" value={totalLoanRequested > 0 ? formatINR(totalLoanRequested) : '₹0'} icon={TrendingDown} color="green" />
          <KPICard title="Assessments" value={String(assessments.length)} icon={Clock} color="teal" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-10 gap-6">
          <Card className="lg:col-span-7">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">Recent Assessments</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {assessments.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No assessments yet. Click "New CAM Assessment" to get started.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px]">Borrower</TableHead>
                        <TableHead className="text-[10px]">Sector</TableHead>
                        <TableHead className="text-[10px] text-right">Loan</TableHead>
                        <TableHead className="text-[10px] text-center">Score</TableHead>
                        <TableHead className="text-[10px]">Status</TableHead>
                        <TableHead className="text-[10px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assessments.map((a) => (
                        <TableRow key={a.id} className="cursor-pointer hover:bg-secondary/50 transition-colors" onClick={() => navigate(`/assessment/${a.id}/results`)}>
                          <TableCell className="font-medium text-sm">{a.borrower_name}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{a.sector || '—'}</TableCell>
                          <TableCell className="text-right font-mono text-sm">{a.loan_requested ? formatINR(a.loan_requested) : '—'}</TableCell>
                          <TableCell className="text-center"><ScoreBadge score={a.composite_score || 0} /></TableCell>
                          <TableCell><StatusBadge status={a.status as any} /></TableCell>
                          <TableCell><Button variant="ghost" size="sm" className="text-xs">View CAM</Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="lg:col-span-3 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-cam-danger animate-live-pulse" />
                  Live Fraud Alerts
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 max-h-64 overflow-y-auto">
                {fraudAlerts.length === 0 && <p className="text-xs text-muted-foreground">No fraud alerts detected.</p>}
                {fraudAlerts.slice(0, 5).map((f) => (
                  <div key={f.id} className="flex items-start gap-2 text-xs border-b border-border pb-2 last:border-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-cam-danger animate-live-pulse mt-1.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{f.borrower_name}</p>
                      <p className="text-muted-foreground">{f.fraud_type}</p>
                    </div>
                    <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${f.severity === 'HIGH' ? 'bg-cam-danger text-primary-foreground' : 'bg-cam-warning text-primary-foreground'}`}>{f.severity}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">Fraud Typology</CardTitle>
              </CardHeader>
              <CardContent>
                {fraudTypesData.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8">No fraud data yet.</p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={fraudTypesData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2}>
                          {fraudTypesData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <RechartsTooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-1 mt-2">
                      {fraudTypesData.map((f, i) => (
                        <div key={f.name} className="flex items-center justify-between text-[10px]">
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                            <span className="text-muted-foreground">{f.name}</span>
                          </div>
                          <span className="font-mono">{f.value}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">CAMs Processed — Recent Weeks</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={weeklyData}>
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'hsl(215,15%,50%)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'hsl(215,15%,50%)' }} />
                  <RechartsTooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="cams" fill="hsl(187,92%,37%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs uppercase tracking-widest text-muted-foreground">Score Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {assessments.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-16">No score data yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={assessments.filter(a => a.composite_score).map((a, i) => ({ name: a.borrower_name.split(' ')[0], score: a.composite_score }))}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'hsl(215,15%,50%)' }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(215,15%,50%)' }} />
                    <RechartsTooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="score" fill="hsl(42,80%,55%)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Button onClick={() => navigate('/assessment/new')} className="fixed bottom-6 right-6 shadow-lg gap-2 z-50" size="lg">
        <Plus className="h-5 w-5" /> New CAM Assessment
      </Button>
    </AppLayout>
  );
}
