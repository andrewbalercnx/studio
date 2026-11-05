import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useChild } from '../src/contexts/ChildContext';
import { useApiClient, type BookListItem } from '../src/contexts/ApiClientContext';
import { bookStatusLabel } from '../src/lib/books';

/**
 * My Books: the active child's Books, newest first (GET /api/books?childId,
 * filtered, sorted and flagged on the server). Each opens the Book view, which
 * shows progress for a Book still being made and the reader once it is ready.
 */
export default function BooksScreen() {
  const router = useRouter();
  const apiClient = useApiClient();
  const { childProfile } = useChild();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setBooks(await apiClient.books.list(childProfile?.id ? { childId: childProfile.id } : {}));
      setError(false);
    } catch (e) {
      console.error('Error loading books:', e);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiClient, childProfile?.id]);

  // Reload when the screen comes back into view (a Book may have finished meanwhile).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{books.length > 0 ? `My Books (${books.length})` : 'My Books'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#F59E0B" />
        </View>
      ) : books.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📚</Text>
          <Text style={styles.emptyTitle}>{error ? "We couldn't load your books" : 'No books yet'}</Text>
          <Text style={styles.emptyText}>
            {error ? 'Pull down to try again.' : 'Finish a story, then tap "Make a picture book" to turn it into a book with pictures.'}
          </Text>
          <TouchableOpacity style={styles.createButton} onPress={() => (error ? load() : router.push('/stories'))}>
            <Text style={styles.createButtonText}>{error ? 'Try again' : 'See My Stories'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={books}
          keyExtractor={(book) => book.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/book/${item.id}`)}>
              <Text style={styles.cardIcon}>{item.isReady ? '📖' : item.status === 'failed' ? '😕' : '🎨'}</Text>
              <View style={styles.cardContent}>
                <Text style={styles.cardTitle} numberOfLines={2}>{item.title || 'My Book'}</Text>
                <Text style={styles.cardSubtitle}>{bookStatusLabel(item)}</Text>
              </View>
              <Text style={styles.cardArrow}>›</Text>
            </TouchableOpacity>
          )}
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
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#92400E',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#B45309',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  createButton: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  list: {
    padding: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  cardIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#92400E',
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#B45309',
    marginTop: 4,
  },
  cardArrow: {
    fontSize: 24,
    color: '#F59E0B',
    marginLeft: 8,
  },
});
