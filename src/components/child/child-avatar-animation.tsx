'use client';

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ChildAvatarAnimationProps {
  /** URL to the avatar animation (mp4, webm, or gif) */
  avatarAnimationUrl?: string | null;
  /** Fallback static avatar URL */
  avatarUrl?: string | null;
  /** Size of the animation container */
  size?: 'sm' | 'md' | 'lg';
  /** Additional CSS classes */
  className?: string;
}

const sizeClasses = {
  sm: 'w-24 h-24',
  md: 'w-32 h-32',
  lg: 'w-40 h-40',
};

// CSS animation keyframes for bouncy dance effect
const danceAnimation = `
  @keyframes avatarDance {
    0%, 100% { transform: translateY(0) rotate(0deg) scale(1); }
    25% { transform: translateY(-8px) rotate(-3deg) scale(1.02); }
    50% { transform: translateY(0) rotate(0deg) scale(1); }
    75% { transform: translateY(-8px) rotate(3deg) scale(1.02); }
  }
`;

/**
 * Displays the child's avatar animation while waiting for AI generation.
 * Supports video formats (mp4, webm) and animated images (gif).
 * Falls back to static avatar, then to a sparkles animation.
 */
export function ChildAvatarAnimation({
  avatarAnimationUrl,
  avatarUrl,
  size = 'md',
  className,
}: ChildAvatarAnimationProps) {
  const [videoError, setVideoError] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Determine if the animation URL is a video
  const isVideo = avatarAnimationUrl &&
    (avatarAnimationUrl.includes('.mp4') || avatarAnimationUrl.includes('.webm'));

  // Reset error states when URLs change
  const handleVideoError = () => setVideoError(true);
  const handleImageError = () => setImageError(true);

  // Show video animation
  if (avatarAnimationUrl && isVideo && !videoError) {
    return (
      <div className={cn('relative', className)}>
        <video
          src={avatarAnimationUrl}
          autoPlay
          loop
          muted
          playsInline
          onError={handleVideoError}
          className={cn(
            sizeClasses[size],
            'rounded-full object-cover shadow-lg ring-4 ring-primary/20'
          )}
        />
        {/* Sparkle decorations */}
        <div className="absolute -top-1 -right-1 text-xl animate-ping">✨</div>
        <div className="absolute -bottom-1 -left-1 text-xl animate-ping" style={{ animationDelay: '0.5s' }}>✨</div>
      </div>
    );
  }

  // Check if it's an actual animated GIF
  const isAnimatedGif = avatarAnimationUrl && avatarAnimationUrl.includes('.gif');

  // Show animated image (gif) - true animated GIF
  if (avatarAnimationUrl && !isVideo && isAnimatedGif && !imageError) {
    return (
      <div className={cn('relative', className)}>
        <img
          src={avatarAnimationUrl}
          alt="Avatar animation"
          onError={handleImageError}
          className={cn(
            sizeClasses[size],
            'rounded-full object-cover shadow-lg ring-4 ring-primary/20'
          )}
        />
        {/* Sparkle decorations */}
        <div className="absolute -top-1 -right-1 text-xl animate-ping">✨</div>
        <div className="absolute -bottom-1 -left-1 text-xl animate-ping" style={{ animationDelay: '0.5s' }}>✨</div>
      </div>
    );
  }

  // Show dance pose image with CSS dance animation (fallback when video generation isn't available)
  if (avatarAnimationUrl && !isVideo && !isAnimatedGif && !imageError) {
    return (
      <div className={cn('relative', className)}>
        <style dangerouslySetInnerHTML={{ __html: danceAnimation }} />
        <img
          src={avatarAnimationUrl}
          alt="Avatar dancing"
          onError={handleImageError}
          className={cn(
            sizeClasses[size],
            'rounded-full object-cover shadow-lg ring-4 ring-primary/20'
          )}
          style={{ animation: 'avatarDance 0.8s ease-in-out infinite' }}
        />
        {/* Sparkle decorations */}
        <div className="absolute -top-1 -right-1 text-xl animate-ping">✨</div>
        <div className="absolute -bottom-1 -left-1 text-xl animate-ping" style={{ animationDelay: '0.5s' }}>✨</div>
      </div>
    );
  }

  // Fallback to static avatar with pulse animation
  if (avatarUrl && !imageError) {
    return (
      <div className={cn('relative', className)}>
        <img
          src={avatarUrl}
          alt="Avatar"
          onError={handleImageError}
          className={cn(
            sizeClasses[size],
            'rounded-full object-cover shadow-lg ring-4 ring-primary/20 animate-pulse'
          )}
        />
        {/* Sparkle decorations */}
        <div className="absolute -top-1 -right-1 text-xl animate-ping">✨</div>
        <div className="absolute -bottom-1 -left-1 text-xl animate-ping" style={{ animationDelay: '0.5s' }}>✨</div>
      </div>
    );
  }

  // Final fallback: Sparkles animation (original behavior)
  return (
    <div className={cn('relative', className)}>
      <div className={cn(
        sizeClasses[size],
        'rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center animate-pulse'
      )}>
        <Sparkles className="h-1/2 w-1/2 text-primary/60 animate-bounce" />
      </div>
      {/* Sparkle decorations */}
      <div className="absolute -top-1 -right-1 text-xl animate-ping">✨</div>
      <div className="absolute -bottom-1 -left-1 text-xl animate-ping" style={{ animationDelay: '0.5s' }}>✨</div>
    </div>
  );
}
