import { cn } from '@/lib/utils';
import { AssessmentStatus } from '@/lib/types';

const statusConfig: Record<AssessmentStatus, { label: string; className: string }> = {
  approved: { label: 'APPROVED', className: 'bg-cam-success/15 text-cam-success border-cam-success/20' },
  conditional: { label: 'CONDITIONAL', className: 'bg-cam-warning/15 text-cam-warning border-cam-warning/20' },
  rejected: { label: 'REJECTED', className: 'bg-destructive/15 text-destructive border-destructive/20' },
  processing: { label: 'PROCESSING', className: 'bg-primary/15 text-primary border-primary/20' },
  review: { label: 'REVIEW', className: 'bg-cam-review/15 text-cam-review border-cam-review/20' },
  draft: { label: 'DRAFT', className: 'bg-muted text-muted-foreground border-border' },
};

export function StatusBadge({ status }: { status: AssessmentStatus }) {
  const config = statusConfig[status];
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
      config.className
    )}>
      <span className={cn(
        'h-1.5 w-1.5 rounded-full',
        status === 'approved' && 'bg-cam-success',
        status === 'conditional' && 'bg-cam-warning',
        status === 'rejected' && 'bg-destructive',
        status === 'processing' && 'bg-primary animate-live-pulse',
        status === 'review' && 'bg-cam-review',
        status === 'draft' && 'bg-muted-foreground',
      )} />
      {config.label}
    </span>
  );
}
