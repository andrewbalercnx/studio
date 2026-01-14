'use client';

import { useMemo } from 'react';
import { ChoiceButton, type ChoiceWithEntities } from './choice-button';
import type { AnswerAnimation } from '@/lib/types';

interface AnimatedChoiceButtonProps {
  choice: ChoiceWithEntities;
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  variant?: 'secondary' | 'outline';
  className?: string;
  optionLabel?: string;
  /** Animation to apply when isAnimating is true */
  animation?: AnswerAnimation | null;
  /** Whether the animation should be playing */
  isAnimating: boolean;
}

/**
 * A ChoiceButton wrapper that supports CSS animations.
 * Used for Q&A exit animations when a child selects an answer.
 */
export function AnimatedChoiceButton({
  choice,
  onClick,
  disabled,
  icon,
  variant = 'secondary',
  className = '',
  optionLabel,
  animation,
  isAnimating,
}: AnimatedChoiceButtonProps) {
  // Build animation style when animating
  const animationStyle = useMemo(() => {
    if (!isAnimating || !animation) return {};
    return {
      animation: `${animation.cssAnimationName} ${animation.durationMs}ms ${animation.easing} forwards`,
    };
  }, [isAnimating, animation]);

  return (
    <>
      {/* Inject CSS keyframes when we have an animation */}
      {animation && (
        <style dangerouslySetInnerHTML={{ __html: animation.cssKeyframes }} />
      )}
      <div style={animationStyle}>
        <ChoiceButton
          choice={choice}
          onClick={onClick}
          disabled={disabled || isAnimating}
          icon={icon}
          variant={variant}
          className={className}
          optionLabel={optionLabel}
        />
      </div>
    </>
  );
}
