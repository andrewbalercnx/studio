import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useChild } from '../src/contexts/ChildContext';
import { useApiClient } from '../src/contexts/ApiClientContext';

interface Storybook {
  id: string;
  storyId: string;
  title?: string;
  pageGeneration?: { status: string };
  imageGeneration?: { status: string; completedCount?: number; totalCount?: number };
  createdAt?: any;
  thumbnailUrl?: string;
}

interface Story {
  id: string;
  metadata?: { title?: string };
  actorAvatarUrl?: string;
  storybooks?: Storybook[];
}

export default function BooksScreen() {
  const router = useRouter();
  const { childId } = useChild();
  const apiClient = useApiClient();

  const [books, setBooks] = useState<Array<Story & { storybook: Storybook }>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadBooks = useCallback(async () => {
    if (!childId) return;
    try {
      const stories = await apiClient.getMyStories(childId);

      // Flatten stories with their storybooks
      const booksWithStorybooks: Array<Story & { storybook: Storybook }> = [];

      for (const story of stories) {
        // Check for legacy book (on story itself)
        if (story.imageGeneration?.status === 'ready' || story.pageGeneration?.status === 'ready') {
          booksWithStorybooks.push({
            ...story,
            storybook: {
              id: story.id,
              storyId: story.id,
              title: story.metadata?.title,
              imageGeneration: story.imageGeneration,
              pageGeneration: story.pageGeneration,
            },
          });
        }

        // Also check for storybooks subcollection
        try {
          const storybooks = await apiClient.getMyStorybooks(story.id);
          for (const sb of storybooks) {
            if (sb.imageGeneration?.status === 'ready') {
              booksWithStorybooks.push({
                ...story,
                storybook: sb,
              });
            }
          }
        } catch (e) {
          // No storybooks subcollection
        }
      }

      // Sort by created date
      booksWithStorybooks.sort((a, b) => {
        const aTime = a.storybook.createdAt?.seconds || 0;
        const bTime = b.storybook.createdAt?.seconds || 0;
        return bTime - aTime;
      });

      setBooks(booksWithStorybooks);
    } catch (e) {
      console.error('Error loading books:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [childId, apiClient]);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const onRefresh = () => {
    setRefreshing(true);
    loadBooks();
  };

  const renderBookCard = ({ item }: { item: Story & { storybook: Storybook } }) => {
    const title = item.storybook.title || item.metadata?.title || 'Untitled Book';
    const storyId = item.storybook.storyId || item.id;
    const storybookId = item.storybook.id;

    return (
      <TouchableOpacity
        style={styles.bookCard}
        onPress={() => router.push(`/book/${storyId}?storybookId=${storybookId}`)}
      >
        {/* Thumbnail */}
        <View style={styles.thumbnailContainer}>
          {item.storybook.thumbnailUrl ? (
            <Image source={{ uri: item.storybook.thumbnailUrl }} style={styles.thumbnail} />
          ) : item.actorAvatarUrl ? (
            <Image source={{ uri: item.actorAvatarUrl }} style={styles.thumbnail} />
          ) : (
            <View style={styles.thumbnailPlaceholder}>
              <Text style={styles.thumbnailIcon}>📚</Text>
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.bookContent}>
          <Text style={styles.bookTitle} numberOfLines={2}>
            {title}
          </Text>
          <View style={styles.statusContainer}>
            <Text style={styles.statusText}>
              📖 Ready to read
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F59E0B" />
        <Text style={styles.loadingText}>Loading books...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Books</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Books List */}
      {books.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📚</Text>
          <Text style={styles.emptyTitle}>No books yet</Text>
          <Text style={styles.emptySubtitle}>
            Create a story first, then turn it into a picture book!
          </Text>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => router.push('/create')}
          >
            <Text style={styles.createButtonText}>✨ Create a Story</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={books}
          numColumns={2}
          keyExtractor={(item) => `${item.id}-${item.storybook.id}`}
          renderItem={renderBookCard}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.listRow}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F59E0B"
            />
          }
        />
      )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
  },
  backButton: {
    paddingVertical: 8,
    paddingRight: 16,
  },
  backText: {
    fontSize: 16,
    color: '#F59E0B',
    fontWeight: '600',
  },
  headerTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: 'bold',
    color: '#92400E',
    textAlign: 'center',
  },
  headerSpacer: {
    width: 60,
  },
  listContent: {
    padding: 12,
    paddingBottom: 24,
  },
  listRow: {
    justifyContent: 'space-between',
  },
  bookCard: {
    width: '48%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    overflow: 'hidden',
  },
  thumbnailContainer: {
    aspectRatio: 1,
    backgroundColor: '#F3F4F6',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  thumbnailPlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E5E7EB',
  },
  thumbnailIcon: {
    fontSize: 48,
  },
  bookContent: {
    padding: 12,
  },
  bookTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 6,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 12,
    color: '#10B981',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  createButton: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
