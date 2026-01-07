import { useState, useEffect, useCallback } from 'react';
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

interface WizardChoice {
  text: string;
}

interface WizardResponse {
  state: 'asking' | 'finished' | 'error';
  question?: string;
  choices?: WizardChoice[];
  answers?: Array<{ question: string; answer: string }>;
  title?: string;
  storyText?: string;
  storyId?: string;
  error?: string;
}

export default function PlayScreen() {
  const router = useRouter();
  const { sessionId, generator } = useLocalSearchParams<{ sessionId: string; generator: string }>();
  const { childId, childProfile } = useChild();
  const apiClient = useApiClient();

  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [wizardState, setWizardState] = useState<WizardResponse | null>(null);
  const [answers, setAnswers] = useState<Array<{ question: string; answer: string }>>([]);

  // Start the wizard on mount
  useEffect(() => {
    startWizard();
  }, []);

  const startWizard = async () => {
    if (!childId || !sessionId) return;

    setLoading(true);
    try {
      const response = await apiClient.sendWizardChoice(childId, sessionId, []);
      setWizardState(response);
      setAnswers(response.answers || []);
    } catch (e: any) {
      console.error('Error starting wizard:', e);
      Alert.alert('Error', e.message || 'Failed to start story');
    } finally {
      setLoading(false);
    }
  };

  const handleChoice = async (choice: WizardChoice) => {
    if (!childId || !sessionId || !wizardState?.question) return;

    setProcessing(true);
    try {
      const newAnswers = [...answers, { question: wizardState.question, answer: choice.text }];
      const response = await apiClient.sendWizardChoice(childId, sessionId, newAnswers);
      setWizardState(response);
      setAnswers(response.answers || newAnswers);

      // If story is finished, navigate to the story
      if (response.state === 'finished' && response.storyId) {
        router.replace(`/story/${response.storyId}`);
      }
    } catch (e: any) {
      console.error('Error sending choice:', e);
      Alert.alert('Error', e.message || 'Something went wrong');
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

  if (wizardState?.state === 'error') {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>😢</Text>
        <Text style={styles.errorTitle}>Oops!</Text>
        <Text style={styles.errorText}>{wizardState.error || 'Something went wrong'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={startWizard}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
                i < answers.length && styles.progressDotFilled,
                i === answers.length && styles.progressDotActive,
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
              <Text style={styles.questionText}>{wizardState?.question}</Text>
            </View>

            {/* Choices */}
            <View style={styles.choicesContainer}>
              {wizardState?.choices?.map((choice, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.choiceButton}
                  onPress={() => handleChoice(choice)}
                >
                  <Text style={styles.choiceLabel}>
                    {String.fromCharCode(65 + index)}
                  </Text>
                  <Text style={styles.choiceText}>{choice.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
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
});
