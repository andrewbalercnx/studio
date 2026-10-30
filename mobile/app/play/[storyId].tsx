import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
  TextInput,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useChild } from '../../src/contexts/ChildContext';
import {
  useApiClient,
  ApiError,
  kidSafeMessage,
  newIdempotencyKey,
  type ChildInput,
  type StoryTurn,
  type StoryView,
} from '../../src/contexts/ApiClientContext';

/** Modes whose engine also takes a typed idea where it offers choices. */
const FREE_TEXT_MODES = new Set(['freeplay', 'guided']);
const RETRY_DELAYS_MS = [1500, 3000, 5000, 8000];
const POLL_MS = 2500;

function latestPrompt(turns: StoryTurn[]): StoryTurn | null {
  const latest = turns.reduce<StoryTurn | null>((acc, t) => (acc === null || t.index > acc.index ? t : acc), null);
  return latest && latest.role === 'ai' && latest.kind === 'prompt' ? latest : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Make a story, turn by turn, in any mode (slice 5.4). The Story and its
 * turns come from GET /api/stories/{id} (the app is API-only); each answer
 * goes to POST /api/stories/{id}/turns with one idempotency key per answer,
 * repeated on a retry. The latest turn says what it expects: a choice, typed
 * text, or a pick of who comes along.
 */
export default function PlayScreen() {
  const router = useRouter();
  const { storyId } = useLocalSearchParams<{ storyId: string }>();
  const { childProfile } = useChild();
  const apiClient = useApiClient();

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [story, setStory] = useState<StoryView | null>(null);
  const [turns, setTurns] = useState<StoryTurn[]>([]);
  const [error, setError] = useState<{ message: string; retry: (() => void) | null } | null>(null);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const keys = useRef(new Map<string, string>());
  const inFlight = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!storyId) return;
    try {
      const result = await apiClient.getStory(storyId);
      setStory(result.story);
      setTurns(result.turns);
      setError(null);
    } catch (e) {
      console.error('Error loading story:', e);
      setError({ message: kidSafeMessage(e), retry: () => load() });
    } finally {
      setLoading(false);
    }
  }, [apiClient, storyId]);

  useEffect(() => {
    load();
  }, [load]);

  const prompt = latestPrompt(turns);

  // A new prompt: start the cast pick from the mode's suggestions (the hero always comes).
  useEffect(() => {
    if (prompt?.expects === 'castPick' && story) {
      setPicked(new Set([story.childId, ...(prompt.options ?? []).filter((o) => o.preselected).map((o) => o.id)]));
    }
    setText('');
  }, [prompt?.index]);

  // Finishing: the server adds the title; poll until the Story is complete.
  useEffect(() => {
    if (story?.status !== 'finishing') return;
    const timer = setInterval(() => load(), POLL_MS);
    return () => clearInterval(timer);
  }, [story?.status, load]);

  useEffect(() => {
    if (story?.status === 'complete' && storyId) router.replace(`/story/${storyId}`);
  }, [story?.status, storyId]);

  const send = async (promptIndex: number, input: ChildInput) => {
    if (!storyId) return;
    const signature = `${promptIndex}|${JSON.stringify(input)}`;
    if (inFlight.current === signature) return; // a double tap while the first request runs
    inFlight.current = signature;
    const idempotencyKey = keys.current.get(signature) ?? newIdempotencyKey();
    keys.current.set(signature, idempotencyKey);
    setSending(true);
    setError(null);
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await apiClient.sendTurn(storyId, input, idempotencyKey);
          break;
        } catch (e) {
          // The server is still working on this same answer: wait, then ask again with the same key.
          if (!(e instanceof ApiError) || e.code !== 'TURN_IN_PROGRESS' || attempt >= RETRY_DELAYS_MS.length) throw e;
          await sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
      await load();
    } catch (e) {
      console.error('Error sending answer:', e);
      const conflict = e instanceof ApiError && (e.code === 'TURN_CONFLICT' || e.code === 'STORY_NOT_CREATING');
      if (conflict) await load();
      setError({ message: kidSafeMessage(e), retry: conflict ? null : () => send(promptIndex, input) });
    } finally {
      inFlight.current = null;
      setSending(false);
    }
  };

  const handleCancel = () => {
    Alert.alert('Leave Story?', 'You can keep it for later — it waits in My Stories.', [
      { text: 'Keep Playing', style: 'cancel' },
      { text: 'Keep for later', onPress: () => router.back() },
      {
        text: 'Stop the story',
        style: 'destructive',
        onPress: async () => {
          if (storyId) await apiClient.abandonStory(storyId).catch((e) => console.error('Error stopping story:', e));
          router.back();
        },
      },
    ]);
  };

  const retryFinish = async () => {
    if (!storyId) return;
    setSending(true);
    try {
      await apiClient.retryFinish(storyId);
      await load();
    } catch (e) {
      setError({ message: kidSafeMessage(e), retry: null });
    } finally {
      setSending(false);
    }
  };

  const avatar = childProfile?.avatarUrl ? (
    <Image source={{ uri: childProfile.avatarUrl }} style={styles.loadingAvatar} />
  ) : (
    <View style={styles.loadingAvatarPlaceholder}>
      <Text style={styles.loadingAvatarText}>{childProfile?.displayName?.charAt(0)?.toUpperCase() || '?'}</Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.avatarContainer}>{avatar}</View>
        <Text style={styles.loadingTitle}>Setting up your story...</Text>
        <ActivityIndicator size="large" color="#F59E0B" style={styles.spinner} />
      </View>
    );
  }

  if (!story) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>📖</Text>
        <Text style={styles.errorTitle}>We couldn't find this story</Text>
        {error?.retry && (
          <TouchableOpacity style={styles.retryButton} onPress={error.retry}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.backLinkButton} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (story.status === 'finishing' || story.status === 'complete') {
    return (
      <View style={styles.loadingContainer}>
        <View style={styles.avatarContainer}>{avatar}</View>
        <Text style={styles.loadingTitle}>Adding the finishing touches!</Text>
        <ActivityIndicator size="large" color="#F59E0B" style={styles.spinner} />
      </View>
    );
  }

  if (story.status === 'failed' || story.status === 'abandoned') {
    const failed = story.status === 'failed';
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>{failed ? '🧙' : '🌙'}</Text>
        <Text style={styles.errorTitle}>{failed ? 'Your story got a bit stuck' : 'This story was stopped'}</Text>
        {failed && <Text style={styles.errorText}>Don&apos;t worry — your story is safe. Let&apos;s try finishing it again!</Text>}
        {failed && (
          <TouchableOpacity style={styles.retryButton} onPress={retryFinish} disabled={sending}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.backLinkButton} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>🧙</Text>
        <Text style={styles.errorTitle}>The storyteller needs a moment!</Text>
        <Text style={styles.errorText}>{error.message}</Text>
        {error.retry && (
          <TouchableOpacity style={styles.retryButton} onPress={error.retry} disabled={sending}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.backLinkButton} onPress={() => setError(null)}>
          <Text style={styles.backLinkText}>Back to the question</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const options = prompt?.options ?? [];
  const expects = prompt?.expects ?? (options.length > 0 ? 'choice' : 'text');
  const progress = prompt?.progress ?? null;
  const totalDots = progress?.of ?? 0;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleCancel} style={styles.cancelButton}>
          <Text style={styles.cancelText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.progress}>
          {Array.from({ length: totalDots }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressDot,
                !!progress && i < progress.step - 1 && styles.progressDotFilled,
                !!progress && i === progress.step - 1 && styles.progressDotActive,
              ]}
            />
          ))}
          {!totalDots && !!progress && <Text style={styles.progressText}>Step {progress.step}</Text>}
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.avatarSection}>{avatar}</View>

        {sending || !prompt ? (
          <View style={styles.processingContainer}>
            <ActivityIndicator size="large" color="#F59E0B" />
            <Text style={styles.processingText}>The storyteller is thinking...</Text>
          </View>
        ) : (
          <>
            <View style={styles.questionContainer}>
              <Text style={styles.questionText}>{prompt.promptDisplay}</Text>
            </View>

            {expects === 'castPick' ? (
              <View style={styles.choicesContainer}>
                {options.map((option) => {
                  const isHero = option.id === story.childId;
                  const on = picked.has(option.id);
                  return (
                    <TouchableOpacity
                      key={option.id}
                      style={[styles.choiceButton, on && styles.choiceButtonOn]}
                      disabled={isHero}
                      onPress={() =>
                        setPicked((current) => {
                          const next = new Set(current);
                          if (next.has(option.id)) next.delete(option.id);
                          else next.add(option.id);
                          return next;
                        })
                      }
                    >
                      <Text style={styles.choiceLabel}>{on ? '✓' : ''}</Text>
                      <Text style={styles.choiceText}>{option.display}</Text>
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity style={styles.retryButton} onPress={() => send(prompt.index, { kind: 'castPick', castIds: [...picked] })}>
                  <Text style={styles.retryButtonText}>Let&apos;s go!</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.choicesContainer}>
                {expects === 'choice' &&
                  options.map((option) => (
                    <TouchableOpacity key={option.id} style={styles.choiceButton} onPress={() => send(prompt.index, { kind: 'choice', optionId: option.id })}>
                      <Text style={styles.choiceLabel}>{option.id.length <= 2 ? option.id : '•'}</Text>
                      <Text style={styles.choiceText}>{option.display}</Text>
                    </TouchableOpacity>
                  ))}
                {(expects === 'text' || FREE_TEXT_MODES.has(story.modeId)) && (
                  <View style={styles.textInputContainer}>
                    <TextInput
                      style={styles.textInput}
                      value={text}
                      onChangeText={setText}
                      placeholder={expects === 'text' ? 'Type your idea here…' : '…or type your own idea'}
                      maxLength={500}
                      multiline
                    />
                    <TouchableOpacity
                      style={[styles.retryButton, !text.trim() && styles.buttonDisabled]}
                      disabled={!text.trim()}
                      onPress={() => send(prompt.index, { kind: 'text', text: text.trim() })}
                    >
                      <Text style={styles.retryButtonText}>Send my idea</Text>
                    </TouchableOpacity>
                  </View>
                )}
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
  choiceButtonOn: {
    borderColor: '#F59E0B',
    backgroundColor: '#FFFBEB',
  },
  progressText: {
    fontSize: 14,
    color: '#92400E',
  },
  textInputContainer: {
    marginTop: 12,
    gap: 12,
  },
  textInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FDE68A',
    padding: 16,
    fontSize: 18,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  buttonDisabled: {
    opacity: 0.5,
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
