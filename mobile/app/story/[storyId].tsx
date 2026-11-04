import { useState, useEffect } from 'react';
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
import { useApiClient, type BookListItem, type StoryView } from '../../src/contexts/ApiClientContext';
import { bookStatusLabel } from '../../src/lib/books';

/**
 * Read a finished Story (GET /api/stories/{id}: title and text with names
 * resolved on the server), see the Books made from it (GET /api/books?storyId)
 * and make a new one. A Story still being made opens the play screen.
 */
export default function StoryScreen() {
  const router = useRouter();
  const { storyId } = useLocalSearchParams<{ storyId: string }>();
  const apiClient = useApiClient();

  const [story, setStory] = useState<StoryView | null>(null);
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStory();
  }, [storyId]);

  const loadStory = async () => {
    if (!storyId) return;
    try {
      const [result, storyBooks] = await Promise.all([
        apiClient.getStory(storyId),
        // A missing Books list only hides the Books section; the story still reads.
        apiClient.getBooks({ storyId }).catch(() => [] as BookListItem[]),
      ]);
      setStory(result.story);
      setBooks(storyBooks);
    } catch (e) {
      console.error('Error loading story:', e);
    } finally {
      setLoading(false);
    }
  };

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

  if (story.status !== 'complete' || !story.text) {
    const finishing = story.status === 'finishing';
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>{finishing ? '⏳' : '✏️'}</Text>
        <Text style={styles.errorTitle}>{finishing ? 'Adding the finishing touches…' : "This story isn't finished yet"}</Text>
        {finishing ? (
          <TouchableOpacity style={styles.backButton} onPress={() => { setLoading(true); loadStory(); }}>
            <Text style={styles.backButtonText}>Check again</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.backButton} onPress={() => router.replace(`/play/${story.id}`)}>
            <Text style={styles.backButtonText}>Keep going</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const title = story.title || 'Your Story';
  const hero = story.cast.find((member) => member.role === 'hero');

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
        {hero?.avatarUrl && (
          <View style={styles.avatarSection}>
            <Image source={{ uri: hero.avatarUrl }} style={styles.storyAvatar} />
          </View>
        )}

        {/* Title */}
        <Text style={styles.title}>{title}</Text>

        {/* Story Text */}
        <View style={styles.storyTextContainer}>
          {story.text.split(/\n\s*\n/).map((paragraph, index) => (
            <Text key={index} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </View>

        {/* Books from this story, then a new one (Form + Style chooser). */}
        <View style={styles.actionsContainer}>
          {books.length > 0 && (
            <Text style={styles.booksHeading}>{books.length === 1 ? '1 picture book' : `${books.length} picture books`}</Text>
          )}
          {books.map((book) => (
            <TouchableOpacity key={book.id} style={[styles.storybookButton, { marginBottom: 12 }]} onPress={() => router.push(`/book/${book.id}`)}>
              <View style={styles.storybookThumbnailPlaceholder}>
                <Text style={styles.storybookThumbnailPlaceholderText}>📖</Text>
              </View>
              <View style={styles.storybookButtonContent}>
                <Text style={styles.storybookButtonTitle}>{book.title || title}</Text>
                <Text style={styles.storybookButtonSubtitle}>{bookStatusLabel(book)}</Text>
              </View>
              <Text style={styles.storybookButtonArrow}>›</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.actionButton, styles.actionButtonSecondary]} onPress={() => router.push(`/create-book/${story.id}`)}>
            <Text style={styles.actionButtonIcon}>🎨</Text>
            <Text style={styles.actionButtonTextSecondary}>{books.length > 0 ? 'Make another picture book' : 'Make a picture book'}</Text>
          </TouchableOpacity>
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
  booksHeading: {
    fontSize: 16,
    fontWeight: '600',
    color: '#92400E',
    marginBottom: 8,
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
  storybookButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B981',
    borderRadius: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  storybookThumbnail: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  storybookThumbnailPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  storybookThumbnailPlaceholderText: {
    fontSize: 24,
  },
  storybookButtonContent: {
    flex: 1,
    marginLeft: 12,
  },
  storybookButtonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  storybookButtonSubtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.8)',
    marginTop: 2,
  },
  storybookButtonArrow: {
    fontSize: 24,
    color: 'rgba(255, 255, 255, 0.8)',
    marginLeft: 8,
  },
});
