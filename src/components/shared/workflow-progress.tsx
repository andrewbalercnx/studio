'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { LoaderCircle, CheckCircle2, Sparkles, Moon } from 'lucide-react';
import { cn } from '@/lib/utils';

type WorkflowProgressProps = {
  title: string;
  description: string;
  status: 'idle' | 'running' | 'ready' | 'error' | 'rate_limited';
  currentStep?: number;
  totalSteps?: number;
  errorMessage?: string | null;
  className?: string;
};

export function WorkflowProgress({
  title,
  description,
  status,
  currentStep,
  totalSteps,
  errorMessage,
  className,
}: WorkflowProgressProps) {
  const progressPercentage =
    currentStep && totalSteps
      ? Math.round((currentStep / totalSteps) * 100)
      : status === 'running'
        ? 50
        : status === 'ready'
          ? 100
          : 0;

  const getStatusIcon = () => {
    switch (status) {
      case 'running':
        return <LoaderCircle className="h-6 w-6 animate-spin text-primary" />;
      case 'ready':
        return <CheckCircle2 className="h-6 w-6 text-green-500" />;
      case 'rate_limited':
        return <Moon className="h-6 w-6 text-amber-500" />;
      case 'error':
        return <span className="text-2xl">⚠️</span>;
      default:
        return <Sparkles className="h-6 w-6 text-muted-foreground" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'running':
        if (currentStep && totalSteps) {
          return `Processing ${currentStep} of ${totalSteps}...`;
        }
        return 'Processing...';
      case 'ready':
        return 'Complete!';
      case 'rate_limited':
        return 'Taking a break - will retry automatically';
      case 'error':
        return errorMessage || 'An error occurred';
      default:
        return 'Waiting to start...';
    }
  };

  return (
    <Card className={cn('border-2',
      status === 'running' && 'border-primary/50 bg-primary/5',
      status === 'ready' && 'border-green-500/50 bg-green-50',
      status === 'rate_limited' && 'border-amber-500/50 bg-amber-50',
      status === 'error' && 'border-destructive/50 bg-destructive/5',
      className
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <div className="flex-1">
            <CardTitle className="text-lg">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress
          value={progressPercentage}
          className={cn(
            "h-2",
            status === 'ready' && "bg-green-100",
            status === 'rate_limited' && "bg-amber-100",
            status === 'error' && "bg-destructive/20"
          )}
        />
        <p className={cn(
          "text-sm",
          status === 'running' && "text-primary font-medium",
          status === 'ready' && "text-green-600 font-medium",
          status === 'rate_limited' && "text-amber-600 font-medium",
          status === 'error' && "text-destructive",
          status === 'idle' && "text-muted-foreground"
        )}>
          {getStatusText()}
        </p>
      </CardContent>
    </Card>
  );
}
