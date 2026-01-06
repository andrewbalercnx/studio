/**
 * Progress Indicators for Story Creation
 *
 * These components visually display story progress during generation.
 * Different indicators can be assigned to different story types.
 */

export { TestTubeIndicator } from './test-tube-indicator';

// Export type for the progress indicator component signature
export type ProgressIndicatorProps = {
  progress: number;
  className?: string;
};
