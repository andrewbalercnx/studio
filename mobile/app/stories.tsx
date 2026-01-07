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

interface Story {
  id: string;
  storySessionId: string;
  metadata?: {
    title?: string;
  };
  synopsis?: string;
  storyText?: string;
  actorAvatarUrl?: string;
  pageGeneration?: { status: string };
  imageGeneration?: { status: string };
  createdAt?: any;
}

export default function StoriesScreen() {
  const router = useRouter();
  const { childId, childProfile } = useChild();
  const apiClient = useApiClient();

  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStories = useCallback(async () => {
    if (!childId) return;
    try {
      const data = await apiClient.getMyStories(childId);
      // Sort by createdAt descending
      const sorted = data.sort((a: Story, b: Story) => {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
        return bTime - aTime;
      });
      setStories(sorted);
    } catch (e) {
      console.error('Error loading stories:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [childId, apiClient]);

  useEffect(() => {
    loadStories();
  }, [loadStories]);

  const onRefresh = () => {
    setRefreshing(true);
    loadStories();
  };

  const getStatusInfo = (story: Story) => {
    const pageStatus = story.pageGeneration?.status ?? 'idle';
    const imageStatus = story.imageGeneration?.status ?? 'idle';
    const hasBook = imageStatus === 'ready';
    const hasStoryText = !!story.storyText;

    if (hasBook) {
      return { text: 'Book ready!', color: '#10B981', icon: '📚' };
    }
    if (pageStatus === 'running' || imageStatus === 'running') {
      return { text: 'Creating...', color: '#F59E0B', icon: '⏳' };
    }
    if (hasStoryText) {
      return { text: 'Story ready', color: '#8B5CF6', icon: '📖' };
    }
    return { text: 'In progress', color: '#6B7280', icon: '✏️' };
  };

  const renderStoryCard = ({ item }: { item: Story }) => {
    const status = getStatusInfo(item);
    const storyId = item.id || item.storySessionId;
    const title = item.metadata?.title || 'Untitled Story';

    return (
      <TouchableOpacity
        style={styles.storyCard}
        onPress={() => router.push(`/story/${storyId}`)}
      >
        {/* Thumbnail */}
        <View style={styles.thumbnailContainer}>
          {item.actorAvatarUrl ? (
            <Image source={{ uri: item.actorAvatarUrl }} style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnailPlaceholder, { backgroundColor: status.color + '20' }]}>
              <Text style={styles.thumbnailIcon}>{status.icon}</Text>
            </View>
          )}
        </View>

        {/* Content */}
        <View style={styles.storyContent}>
          <Text style={styles.storyTitle} numberOfLines={1}>
            {title}
          </Text>
          {item.synopsis && (
            <Text style={styles.storySynopsis} numberOfLines={2}>
              {item.synopsis}
            </Text>
          )}
          <View style={styles.statusContainer}>
            <Text style={[styles.statusText, { color: status.color }]}>
              {status.icon} {status.text}
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
        <Text style={styles.loadingText}>Loading stories...</Text>
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
        <Text style={styles.headerTitle}>My Stories</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Stories List */}
      {stories.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📖</Text>
          <Text style={styles.emptyTitle}>No stories yet</Text>
          <Text style={styles.emptySubtitle}>
            Create your first magical story!
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
          data={stories}
          keyExtractor={(item) => item.id || item.storySessionId}
          renderItem={renderStoryCard}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F59E0B"
            />
          }
        />
      )}

      {/* Floating Create Button */}
      {stories.length > 0 && (
        <TouchableOpacity
          style={styles.floatingButton}
          onPress={() => router.push('/create')}
        >
          <Text style={styles.floatingButtonText}>✨</Text>
        </TouchableOpacity>
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
    padding: 16,
    paddingBottom: 80,
  },
  storyCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  thumbnailContainer: {
    marginRight: 12,
  },
  thumbnail: {
    width: 64,
    height: 64,
    borderRadius: 12,
  },
  thumbnailPlaceholder: {
    width: 64,
    height: 64,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailIcon: {
    fontSize: 28,
  },
  storyContent: {
    flex: 1,
    justifyContent: 'center',
  },
  storyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 4,
  },
  storySynopsis: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
    lineHeight: 18,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusText: {
    fontSize: 13,
    fontWeight: '500',
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
  floatingButton: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  floatingButtonText: {
    fontSize: 28,
  },
});
