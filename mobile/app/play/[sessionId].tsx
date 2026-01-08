import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useChild } from '../../src/contexts/ChildContext';
import { useApiClient } from '../../src/contexts/ApiClientContext';

// API response format (StoryGeneratorResponse)
interface WizardOption {
  id: string;       // 'A', 'B', 'C', 'D'
  text: string;
  textResolved?: string;
}

interface WizardResponse {
  ok: boolean;
  sessionId: string;
  question?: string;
  questionResolved?: string;
  options?: WizardOption[];
  isStoryComplete?: boolean;
  finalStory?: string;
  progress?: number;
  errorMessage?: string;
}

export default function PlayScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { childProfile } = useChild();
  const apiClient = useApiClient();

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [response, setResponse] = useState<WizardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start the wizard on mount
  useEffect(() => {
    startWizard();
  }, [sessionId]);

  const startWizard = async () => {
    if (!sessionId) return;

    setLoading(true);
    setError(null);
    try {
      // Initial call without selectedOptionId gets first question
      const result = await apiClient.sendWizardChoice(sessionId);
      setResponse(result);

      // If story is already complete (shouldn't happen on first call, but handle it)
      if (result.isStoryComplete) {
        router.replace(`/story/${sessionId}`);
      }
    } catch (e: any) {
      console.error('Error starting wizard:', e);
      setError(e.message || 'Failed to start story');
    } finally {
      setLoading(false);
    }
  };

  const handleChoice = async (option: WizardOption) => {
    if (!sessionId) return;

    setProcessing(true);
    setError(null);
    try {
      // Send the option ID (A, B, C, D)
      const result = await apiClient.sendWizardChoice(sessionId, option.id);
      setResponse(result);

      // If story is complete, navigate to the story
      if (result.isStoryComplete) {
        router.replace(`/story/${sessionId}`);
      }
    } catch (e: any) {
      console.error('Error sending choice:', e);
      setError(e.message || 'Something went wrong');
    } finally {
      setProcessing(false);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      'Leave Story?',
      'Your progress will be lost.',
      [
        { text: 'Keep Playing', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => router.back() },
      ]
    );
  };

  // Calculate progress dots based on API progress (0-1)
  const progress = response?.progress ?? 0;
  const progressDots = Math.round(progress * 4); // 4 questions = 4 dots

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.avatarContainer}>
          {childProfile?.avatarUrl ? (
            <Image source={{ uri: childProfile.avatarUrl }} style={styles.loadingAvatar} />
          ) : (
            <View style={styles.loadingAvatarPlaceholder}>
              <Text style={styles.loadingAvatarText}>
                {childProfile?.displayName?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
        </View>
        <Text style={styles.loadingTitle}>Setting up your story...</Text>
        <ActivityIndicator size="large" color="#F59E0B" style={styles.spinner} />
      </View>
    );
  }

  if (error || (response && !response.ok)) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>😢</Text>
        <Text style={styles.errorTitle}>Oops!</Text>
        <Text style={styles.errorText}>{error || response?.errorMessage || 'Something went wrong'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={startWizard}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.backLinkButton} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Get the question and options (use resolved text if available)
  const questionText = response?.questionResolved || response?.question || '';
  const options = response?.options || [];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleCancel} style={styles.cancelButton}>
          <Text style={styles.cancelText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.progress}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                i < progressDots && styles.progressDotFilled,
                i === progressDots && i < 4 && styles.progressDotActive,
              ]}
            />
          ))}
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {/* Main Content */}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          {childProfile?.avatarUrl ? (
            <Image source={{ uri: childProfile.avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>
                {childProfile?.displayName?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
        </View>

        {/* Processing State */}
        {processing ? (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color="#F59E0B" />
            <Text style={styles.processingText}>The wizard is thinking...</Text>
          </View>
        ) : (
          <>
            {/* Question */}
            <View style={styles.questionContainer}>
              <Text style={styles.questionText}>{questionText}</Text>
            </View>

            {/* Choices */}
            <View style={styles.choicesContainer}>
              {options.map((option) => (
                <TouchableOpacity
                  key={option.id}
                  style={styles.choiceButton}
                  onPress={() => handleChoice(option)}
                >
                  <Text style={styles.choiceLabel}>{option.id}</Text>
                  <Text style={styles.choiceText}>
                    {option.textResolved || option.text}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {options.length === 0 && !processing && (
              <View style={styles.noOptionsContainer}>
                <Text style={styles.noOptionsText}>No options available</Text>
                <TouchableOpacity style={styles.retryButton} onPress={startWizard}>
                  <Text style={styles.retryButtonText}>Try Again</Text>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEF3C7',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    padding: 40,
  },
  avatarContainer: {
    marginBottom: 24,
  },
  loadingAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#F59E0B',
  },
  loadingAvatarPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#FDE68A',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#F59E0B',
  },
  loadingAvatarText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#92400E',
  },
  loadingTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#92400E',
    marginBottom: 16,
    textAlign: 'center',
  },
  spinner: {
    marginTop: 8,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    padding: 40,
  },
  errorIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#92400E',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 16,
    color: '#B45309',
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  backLinkButton: {
    marginTop: 16,
    paddingVertical: 8,
  },
  backLinkText: {
    color: '#92400E',
    fontSize: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
  },
  cancelButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 24,
    color: '#9CA3AF',
  },
  progress: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E5E7EB',
  },
  progressDotFilled: {
    backgroundColor: '#10B981',
  },
  progressDotActive: {
    backgroundColor: '#F59E0B',
    transform: [{ scale: 1.2 }],
  },
  headerSpacer: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FDE68A',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  avatarInitial: {
    fontSize: 40,
    fontWeight: 'bold',
    color: '#92400E',
  },
  processingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  processingText: {
    fontSize: 18,
    color: '#92400E',
    marginTop: 16,
  },
  questionContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  questionText: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1F2937',
    textAlign: 'center',
    lineHeight: 32,
  },
  choicesContainer: {
    gap: 12,
  },
  choiceButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  choiceLabel: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F59E0B',
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 36,
    marginRight: 16,
    overflow: 'hidden',
  },
  choiceText: {
    flex: 1,
    fontSize: 18,
    color: '#374151',
    lineHeight: 24,
  },
  noOptionsContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  noOptionsText: {
    fontSize: 16,
    color: '#6B7280',
    marginBottom: 16,
  },
});
