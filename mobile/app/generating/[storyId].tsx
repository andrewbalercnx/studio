import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Image,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApiClient } from '../../src/contexts/ApiClientContext';
import { useChild } from '../../src/contexts/ChildContext';

type GenerationPhase = 'pages' | 'images' | 'complete' | 'error';

export default function GeneratingScreen() {
  const router = useRouter();
  const { storyId, storybookId } = useLocalSearchParams<{ storyId: string; storybookId: string }>();
  const apiClient = useApiClient();
  const { childProfile } = useChild();

  const [phase, setPhase] = useState<GenerationPhase>('pages');
  const [pagesReady, setPagesReady] = useState(0);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Animation for the wizard
  const bounceAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Start bounce animation
    const bounce = Animated.loop(
      Animated.sequence([
        Animated.timing(bounceAnim, {
          toValue: -10,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(bounceAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    bounce.start();

    return () => bounce.stop();
  }, []);

  useEffect(() => {
    if (!storyId || !storybookId) {
      setError('Missing story information');
      return;
    }
    startGeneration();
  }, [storyId, storybookId]);

  const startGeneration = async () => {
    try {
      // Phase 1: Generate pages
      setPhase('pages');
      const pagesResult = await apiClient.generatePages(storyId!, storybookId!);

      if (!pagesResult.ok) {
        throw new Error(pagesResult.errorMessage || 'Failed to generate pages');
      }

      setPagesTotal(pagesResult.pagesCount || 12);

      // Phase 2: Generate images
      setPhase('images');
      const imagesResult = await apiClient.generateImages(storyId!, storybookId!);

      if (!imagesResult.ok) {
        throw new Error(imagesResult.errorMessage || 'Failed to generate images');
      }

      // Complete!
      setPhase('complete');

      // Wait a moment then navigate to the book
      setTimeout(() => {
        router.replace(`/book/${storyId}?storybookId=${storybookId}`);
      }, 1500);
    } catch (e: any) {
      console.error('Generation error:', e);
      setError(e.message || 'Something went wrong');
      setPhase('error');
    }
  };

  const handleRetry = () => {
    setError(null);
    startGeneration();
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel?',
      'Are you sure you want to stop creating your book?',
      [
        { text: 'Keep Going', style: 'cancel' },
        { text: 'Yes, Cancel', style: 'destructive', onPress: () => router.back() },
      ]
    );
  };

  const getMessage = () => {
    switch (phase) {
      case 'pages':
        return "Writing your story pages...";
      case 'images':
        return "Painting your pictures...";
      case 'complete':
        return "Your book is ready!";
      case 'error':
        return "Oops! Something went wrong.";
      default:
        return "Creating your book...";
    }
  };

  const getSubMessage = () => {
    switch (phase) {
      case 'pages':
        return "The wizard is arranging your story";
      case 'images':
        return pagesTotal > 0
          ? `Making ${pagesTotal} beautiful pictures`
          : "Creating beautiful illustrations";
      case 'complete':
        return "Let's read it together!";
      case 'error':
        return error || "Please try again";
      default:
        return "This may take a minute...";
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        {/* Animated Character */}
        <Animated.View style={[styles.characterContainer, { transform: [{ translateY: bounceAnim }] }]}>
          {childProfile?.avatarUrl ? (
            <Image source={{ uri: childProfile.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarEmoji}>🧙‍♂️</Text>
            </View>
          )}
        </Animated.View>

        {/* Status */}
        <View style={styles.statusContainer}>
          {phase !== 'error' && phase !== 'complete' && (
            <ActivityIndicator size="large" color="#F59E0B" style={styles.spinner} />
          )}

          {phase === 'complete' && (
            <Text style={styles.completeIcon}>✨</Text>
          )}

          {phase === 'error' && (
            <Text style={styles.errorIcon}>😢</Text>
          )}

          <Text style={styles.message}>{getMessage()}</Text>
          <Text style={styles.subMessage}>{getSubMessage()}</Text>

          {/* Progress indicator for images phase */}
          {phase === 'images' && pagesTotal > 0 && (
            <View style={styles.progressContainer}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${Math.min(100, (pagesReady / pagesTotal) * 100)}%` }]} />
              </View>
              <Text style={styles.progressText}>
                {pagesReady} of {pagesTotal} pages
              </Text>
            </View>
          )}
        </View>

        {/* Action Buttons */}
        <View style={styles.buttonsContainer}>
          {phase === 'error' && (
            <>
              <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelButton} onPress={() => router.back()}>
                <Text style={styles.cancelButtonText}>Go Back</Text>
              </TouchableOpacity>
            </>
          )}

          {(phase === 'pages' || phase === 'images') && (
            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEF3C7',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  characterContainer: {
    marginBottom: 40,
  },
  avatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  avatarPlaceholder: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  avatarEmoji: {
    fontSize: 64,
  },
  statusContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  spinner: {
    marginBottom: 20,
  },
  completeIcon: {
    fontSize: 48,
    marginBottom: 20,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 20,
  },
  message: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#92400E',
    textAlign: 'center',
    marginBottom: 8,
  },
  subMessage: {
    fontSize: 16,
    color: '#B45309',
    textAlign: 'center',
  },
  progressContainer: {
    marginTop: 24,
    width: '100%',
    alignItems: 'center',
  },
  progressBar: {
    width: '80%',
    height: 8,
    backgroundColor: '#FDE68A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#F59E0B',
    borderRadius: 4,
  },
  progressText: {
    marginTop: 8,
    fontSize: 14,
    color: '#92400E',
  },
  buttonsContainer: {
    alignItems: 'center',
    gap: 12,
  },
  retryButton: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  cancelButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  cancelButtonText: {
    color: '#92400E',
    fontSize: 16,
  },
});
