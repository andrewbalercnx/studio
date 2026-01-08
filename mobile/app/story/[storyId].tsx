import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { useChild } from '../../src/contexts/ChildContext';
import { useApiClient } from '../../src/contexts/ApiClientContext';

interface Story {
  id: string;
  metadata?: {
    title?: string;
  };
  synopsis?: string;
  storyText?: string;
  actorAvatarUrl?: string;
  audioUrl?: string;
  audioGeneration?: { status: string };
  pageGeneration?: { status: string };
  imageGeneration?: { status: string };
}

interface Storybook {
  id: string;
  storyId: string;
  imageGeneration?: { status: string };
  thumbnailUrl?: string;
  imageStyleName?: string;
  outputTypeName?: string;
}

export default function StoryScreen() {
  const router = useRouter();
  const { storyId } = useLocalSearchParams<{ storyId: string }>();
  const { childProfile } = useChild();
  const apiClient = useApiClient();

  const [story, setStory] = useState<Story | null>(null);
  const [storybooks, setStorybooks] = useState<Storybook[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sound, setSound] = useState<Audio.Sound | null>(null);

  useEffect(() => {
    loadStory();
    return () => {
      // Cleanup audio
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [storyId]);

  const loadStory = async () => {
    if (!storyId) return;
    try {
      const [storyData, storybooksData] = await Promise.all([
        apiClient.getStory(storyId),
        apiClient.getMyStorybooks(storyId).catch(() => []),
      ]);
      setStory(storyData);
      // Server returns only ready storybooks by default
      setStorybooks(storybooksData);
    } catch (e) {
      console.error('Error loading story:', e);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayAudio = async () => {
    if (!story?.audioUrl) return;

    if (isPlaying && sound) {
      await sound.pauseAsync();
      setIsPlaying(false);
      return;
    }

    try {
      if (sound) {
        await sound.playAsync();
        setIsPlaying(true);
      } else {
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: story.audioUrl },
          { shouldPlay: true },
          (status) => {
            if (status.isLoaded && status.didJustFinish) {
              setIsPlaying(false);
            }
          }
        );
        setSound(newSound);
        setIsPlaying(true);
      }
    } catch (e) {
      console.error('Error playing audio:', e);
    }
  };

  // Check for storybooks (new model) or legacy book (on story itself)
  const hasStorybooks = storybooks.length > 0;
  const hasLegacyBook = story?.imageGeneration?.status === 'ready';
  const hasBook = hasStorybooks || hasLegacyBook;
  const hasAudio = story?.audioGeneration?.status === 'ready' && story?.audioUrl;
  const isGenerating = story?.pageGeneration?.status === 'running' ||
                       story?.imageGeneration?.status === 'running';

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F59E0B" />
        <Text style={styles.loadingText}>Loading story...</Text>
      </View>
    );
  }

  if (!story) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>📖</Text>
        <Text style={styles.errorTitle}>Story not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const title = story.metadata?.title || 'Your Story';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBackButton}>
          <Text style={styles.headerBackText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Story Avatar */}
        {story.actorAvatarUrl && (
          <View style={styles.avatarSection}>
            <Image source={{ uri: story.actorAvatarUrl }} style={styles.storyAvatar} />
          </View>
        )}

        {/* Title */}
        <Text style={styles.title}>{title}</Text>

        {/* Audio Button */}
        {hasAudio && (
          <TouchableOpacity
            style={[styles.audioButton, isPlaying && styles.audioButtonPlaying]}
            onPress={handlePlayAudio}
          >
            <Text style={styles.audioButtonIcon}>{isPlaying ? '⏸️' : '🔊'}</Text>
            <Text style={styles.audioButtonText}>
              {isPlaying ? 'Pause' : 'Read to Me'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Story Text */}
        <View style={styles.storyTextContainer}>
          {story.storyText?.split('\n\n').map((paragraph, index) => (
            <Text key={index} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </View>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          {/* Show existing storybooks */}
          {hasStorybooks && storybooks.map((sb) => (
            <TouchableOpacity
              key={sb.id}
              style={[styles.actionButton, styles.actionButtonPrimary, { marginBottom: 12 }]}
              onPress={() => router.push(`/book/${storyId}?storybookId=${sb.id}`)}
            >
              <Text style={styles.actionButtonIcon}>📚</Text>
              <Text style={styles.actionButtonTextPrimary}>
                {sb.imageStyleName || sb.outputTypeName || 'Read Picture Book'}
              </Text>
            </TouchableOpacity>
          ))}

          {/* Show legacy book button if exists */}
          {hasLegacyBook && (
            <TouchableOpacity
              style={[styles.actionButton, styles.actionButtonPrimary, { marginBottom: 12 }]}
              onPress={() => router.push(`/book/${storyId}`)}
            >
              <Text style={styles.actionButtonIcon}>📚</Text>
              <Text style={styles.actionButtonTextPrimary}>Read Picture Book</Text>
            </TouchableOpacity>
          )}

          {/* Show generating indicator if in progress */}
          {isGenerating && (
            <View style={[styles.generatingContainer, { marginBottom: 12 }]}>
              <ActivityIndicator color="#F59E0B" />
              <Text style={styles.generatingText}>Creating your book...</Text>
            </View>
          )}

          {/* Always show create button (unless currently generating) */}
          {!isGenerating && (
            <TouchableOpacity
              style={[styles.actionButton, styles.actionButtonSecondary]}
              onPress={() => router.push(`/create-book/${storyId}`)}
            >
              <Text style={styles.actionButtonIcon}>✨</Text>
              <Text style={styles.actionButtonTextSecondary}>
                {hasBook ? 'Create Another Book' : 'Create Picture Book'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
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
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#B45309',
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
    fontSize: 20,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
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
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
  },
  headerBackButton: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  headerBackText: {
    fontSize: 16,
    color: '#F59E0B',
    fontWeight: '600',
  },
  headerSpacer: {
    flex: 1,
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
    marginBottom: 20,
  },
  storyAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#92400E',
    textAlign: 'center',
    marginBottom: 20,
  },
  audioButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
    marginBottom: 24,
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 2,
    borderColor: '#8B5CF6',
  },
  audioButtonPlaying: {
    backgroundColor: '#8B5CF6',
  },
  audioButtonIcon: {
    fontSize: 24,
    marginRight: 8,
  },
  audioButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#8B5CF6',
  },
  storyTextContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  paragraph: {
    fontSize: 18,
    lineHeight: 28,
    color: '#374151',
    marginBottom: 16,
  },
  actionsContainer: {
    marginTop: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  actionButtonPrimary: {
    backgroundColor: '#10B981',
  },
  actionButtonSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#F59E0B',
  },
  actionButtonIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  actionButtonTextPrimary: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  actionButtonTextSecondary: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F59E0B',
  },
  generatingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    backgroundColor: '#FDE68A',
    borderRadius: 16,
  },
  generatingText: {
    fontSize: 16,
    color: '#92400E',
    marginLeft: 12,
  },
});
