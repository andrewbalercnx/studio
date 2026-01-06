'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface TestTubeIndicatorProps {
  /** Progress value between 0 and 1 */
  progress: number;
  /** Optional className for container */
  className?: string;
  /** Primary color for the liquid (CSS color value) */
  liquidColor?: string;
  /** Glow color for the liquid (CSS color value) */
  glowColor?: string;
  /** Whether to show animated bubbles */
  showBubbles?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Test Tube Progress Indicator
 *
 * Displays a test tube that fills with glowing liquid as progress increases.
 * The liquid has a magical glow effect and optional bubbles.
 */
export function TestTubeIndicator({
  progress,
  className,
  liquidColor = '#8B5CF6', // Purple
  glowColor = '#C4B5FD',   // Light purple
  showBubbles = true,
  size = 'md',
}: TestTubeIndicatorProps) {
  // Animate the fill smoothly
  const [displayProgress, setDisplayProgress] = useState(0);

  useEffect(() => {
    // Smoothly animate to the target progress
    const animationFrame = requestAnimationFrame(() => {
      setDisplayProgress(Math.max(0, Math.min(1, progress)));
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [progress]);

  // Size dimensions
  const dimensions = {
    sm: { width: 32, height: 120, strokeWidth: 2 },
    md: { width: 48, height: 180, strokeWidth: 3 },
    lg: { width: 64, height: 240, strokeWidth: 4 },
  }[size];

  // Calculate fill height (from bottom, accounting for rounded bottom)
  const tubeBodyHeight = dimensions.height - 40; // Account for cork and rounded bottom
  const fillHeight = tubeBodyHeight * displayProgress;
  const fillY = dimensions.height - 20 - fillHeight; // Start from bottom

  // Generate random bubble positions
  const bubbles = showBubbles && displayProgress > 0.1
    ? Array.from({ length: 5 }, (_, i) => ({
        id: i,
        cx: dimensions.width / 2 + (Math.random() - 0.5) * (dimensions.width * 0.4),
        delay: i * 0.3,
        duration: 1.5 + Math.random() * 0.5,
        r: 2 + Math.random() * 2,
      }))
    : [];

  return (
    <div className={cn('relative', className)}>
      <svg
        width={dimensions.width}
        height={dimensions.height}
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
        className="drop-shadow-lg"
      >
        <defs>
          {/* Gradient for the liquid */}
          <linearGradient id="liquidGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={liquidColor} stopOpacity="0.9" />
            <stop offset="50%" stopColor={glowColor} stopOpacity="1" />
            <stop offset="100%" stopColor={liquidColor} stopOpacity="0.9" />
          </linearGradient>

          {/* Glow filter for magical effect */}
          <filter id="liquidGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Glass highlight gradient */}
          <linearGradient id="glassHighlight" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="white" stopOpacity="0.3" />
            <stop offset="40%" stopColor="white" stopOpacity="0.1" />
            <stop offset="60%" stopColor="white" stopOpacity="0.05" />
            <stop offset="100%" stopColor="white" stopOpacity="0.2" />
          </linearGradient>

          {/* Clip path for liquid inside tube */}
          <clipPath id="tubeClip">
            <path
              d={`
                M ${dimensions.width * 0.25} 25
                L ${dimensions.width * 0.25} ${dimensions.height - 30}
                Q ${dimensions.width * 0.25} ${dimensions.height - 10}
                  ${dimensions.width * 0.5} ${dimensions.height - 10}
                Q ${dimensions.width * 0.75} ${dimensions.height - 10}
                  ${dimensions.width * 0.75} ${dimensions.height - 30}
                L ${dimensions.width * 0.75} 25
                Z
              `}
            />
          </clipPath>
        </defs>

        {/* Cork at top */}
        <rect
          x={dimensions.width * 0.2}
          y={5}
          width={dimensions.width * 0.6}
          height={20}
          rx={4}
          fill="#8B4513"
          stroke="#654321"
          strokeWidth={1}
        />
        {/* Cork lines */}
        <line
          x1={dimensions.width * 0.3}
          y1={8}
          x2={dimensions.width * 0.3}
          y2={22}
          stroke="#654321"
          strokeWidth={0.5}
          opacity={0.5}
        />
        <line
          x1={dimensions.width * 0.5}
          y1={8}
          x2={dimensions.width * 0.5}
          y2={22}
          stroke="#654321"
          strokeWidth={0.5}
          opacity={0.5}
        />
        <line
          x1={dimensions.width * 0.7}
          y1={8}
          x2={dimensions.width * 0.7}
          y2={22}
          stroke="#654321"
          strokeWidth={0.5}
          opacity={0.5}
        />

        {/* Tube outline */}
        <path
          d={`
            M ${dimensions.width * 0.25} 25
            L ${dimensions.width * 0.25} ${dimensions.height - 30}
            Q ${dimensions.width * 0.25} ${dimensions.height - 10}
              ${dimensions.width * 0.5} ${dimensions.height - 10}
            Q ${dimensions.width * 0.75} ${dimensions.height - 10}
              ${dimensions.width * 0.75} ${dimensions.height - 30}
            L ${dimensions.width * 0.75} 25
          `}
          fill="none"
          stroke="rgba(100, 100, 100, 0.3)"
          strokeWidth={dimensions.strokeWidth}
          strokeLinecap="round"
        />

        {/* Liquid fill with glow */}
        <g clipPath="url(#tubeClip)">
          {/* Main liquid body */}
          <rect
            x={dimensions.width * 0.25}
            y={fillY}
            width={dimensions.width * 0.5}
            height={fillHeight + 30} // Extend past bottom for rounded corner
            fill="url(#liquidGradient)"
            filter="url(#liquidGlow)"
            style={{
              transition: 'y 0.5s ease-out, height 0.5s ease-out',
            }}
          />

          {/* Liquid surface wave effect */}
          {displayProgress > 0.05 && (
            <ellipse
              cx={dimensions.width * 0.5}
              cy={fillY}
              rx={dimensions.width * 0.22}
              ry={3}
              fill={glowColor}
              opacity={0.6}
              style={{
                transition: 'cy 0.5s ease-out',
              }}
            >
              <animate
                attributeName="ry"
                values="3;4;3"
                dur="2s"
                repeatCount="indefinite"
              />
            </ellipse>
          )}

          {/* Bubbles */}
          {bubbles.map((bubble) => (
            <circle
              key={bubble.id}
              cx={bubble.cx}
              r={bubble.r}
              fill={glowColor}
              opacity={0.7}
            >
              <animate
                attributeName="cy"
                values={`${dimensions.height - 30};${fillY + 10}`}
                dur={`${bubble.duration}s`}
                begin={`${bubble.delay}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.7;0.3;0"
                dur={`${bubble.duration}s`}
                begin={`${bubble.delay}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
        </g>

        {/* Glass highlight overlay */}
        <path
          d={`
            M ${dimensions.width * 0.25} 25
            L ${dimensions.width * 0.25} ${dimensions.height - 30}
            Q ${dimensions.width * 0.25} ${dimensions.height - 10}
              ${dimensions.width * 0.5} ${dimensions.height - 10}
            Q ${dimensions.width * 0.75} ${dimensions.height - 10}
              ${dimensions.width * 0.75} ${dimensions.height - 30}
            L ${dimensions.width * 0.75} 25
          `}
          fill="url(#glassHighlight)"
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth={1}
        />

        {/* Rim highlight */}
        <ellipse
          cx={dimensions.width * 0.5}
          cy={25}
          rx={dimensions.width * 0.25}
          ry={3}
          fill="rgba(255, 255, 255, 0.3)"
        />
      </svg>

      {/* Progress percentage label (optional, hidden by default) */}
      <span className="sr-only">
        {Math.round(displayProgress * 100)}% complete
      </span>
    </div>
  );
}
