'use client';
import { cn } from '@/lib/utils';
import { CheckCircle, Circle, CircleDot } from 'lucide-react';

type Step = {
  id: string;
  name: string;
};

type StepperProps = {
  steps: Step[];
  currentStep: number;
};

export function Stepper({ steps, currentStep }: StepperProps) {
  return (
    <div className="flex justify-between items-center p-4 bg-card rounded-xl shadow-sm border">
      {steps.map((step, index) => {
        const status =
          index < currentStep ? 'complete' : index === currentStep ? 'current' : 'upcoming';
        
        return (
          <div key={step.id} className={cn("flex items-center space-x-2 md:space-x-4",
            index > 0 && "flex-1 justify-center",
            index === steps.length -1 && 'ml-auto flex-none'
          )}>
            {index > 0 && <div className={cn("flex-1 h-1 rounded", status === 'complete' ? 'bg-primary' : 'bg-muted')}/>}
            <div className='flex items-center space-x-2'>
              {status === 'complete' && <CheckCircle className="h-6 w-6 text-primary" />}
              {status === 'current' && <CircleDot className="h-6 w-6 text-primary animate-pulse" />}
              {status === 'upcoming' && <Circle className="h-6 w-6 text-muted-foreground" />}
              <span className={cn(
                "font-medium hidden sm:inline",
                status === 'current' ? 'text-primary' : 'text-foreground',
                status === 'upcoming' && 'text-muted-foreground',
              )}>
                {step.name}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
