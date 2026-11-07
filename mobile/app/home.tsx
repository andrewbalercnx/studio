import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useChild } from '../src/contexts/ChildContext';
import { useApiClient, type LibraryCounts } from '../src/contexts/ApiClientContext';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandMark, Icon } from '../src/components/brand';

export default function HomeScreen() {
  const router = useRouter();
  const { childProfile, clearChild } = useChild();
  const apiClient = useApiClient();
  const [counts, setCounts] = useState<LibraryCounts | null>(null);

  // How many stories and books this child has (server counts), refreshed on return.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      apiClient
        .librarySummary()
        .then((summary) => {
          if (!cancelled) setCounts((childProfile?.id && summary.byChild[childProfile.id]) || { stories: 0, books: 0 });
        })
        .catch(() => undefined); // the cards still work without counts
      return () => {
        cancelled = true;
      };
    }, [apiClient, childProfile?.id])
  );

  const handleSwitchChild = async () => {
    await clearChild();
    router.replace('/select-child');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Brand strip */}
      <View style={styles.brandRow}>
        <BrandMark size={26} />
        <Text style={styles.brandName}>StoryPic Kids</Text>
      </View>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.avatarButton} onPress={handleSwitchChild}>
          {childProfile?.likeness?.avatar ? (
            <Image source={{ uri: childProfile.likeness.avatar }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>
                {childProfile?.displayName?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.greeting}>Hello,</Text>
          <Text style={styles.name}>{childProfile?.displayName || 'Friend'}!</Text>
        </View>
      </View>

      {/* Main Content */}
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Create Story Card */}
        <TouchableOpacity
          style={[styles.card, styles.createCard]}
          onPress={() => router.push('/create')}
        >
          <View style={styles.cardIcon}><Icon name="create" size={42} color="#ffffff" /></View>
          <Text style={styles.cardTitle}>Create a Story</Text>
          <Text style={styles.cardDescription}>
            Make your own magical adventure!
          </Text>
        </TouchableOpacity>

        {/* My Stories Card */}
        <TouchableOpacity
          style={[styles.card, styles.storiesCard]}
          onPress={() => router.push('/stories')}
        >
          <View style={styles.cardIcon}><Icon name="stories" size={42} color="#ffffff" /></View>
          <Text style={styles.cardTitle}>My Stories</Text>
          <Text style={styles.cardDescription}>
            {counts ? `${counts.stories} ${counts.stories === 1 ? 'story' : 'stories'} to read →` : 'Read your amazing stories!'}
          </Text>
        </TouchableOpacity>

        {/* My Books Card */}
        <TouchableOpacity
          style={[styles.card, styles.booksCard]}
          onPress={() => router.push('/books')}
        >
          <View style={styles.cardIcon}><Icon name="library" size={42} color="#ffffff" /></View>
          <Text style={styles.cardTitle}>My Books</Text>
          <Text style={styles.cardDescription}>
            {counts ? `${counts.books} picture ${counts.books === 1 ? 'book' : 'books'} →` : 'View your picture books!'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f1fb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#ede7fb',
  },
  avatarButton: {
    marginRight: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: '#ede7fb',
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ede7fb',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#7c6ae0',
  },
  avatarInitial: {
    fontSize: 24,
    fontWeight: 'bold', fontFamily: 'PTSans_700Bold',
    color: '#4b3b86',
  },
  headerText: {
    flex: 1,
  },
  greeting: {
    fontSize: 16,
    color: '#4b3b86',
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold', fontFamily: 'PTSans_700Bold',
    color: '#4b3b86',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    gap: 16,
  },
  card: {
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  createCard: {
    backgroundColor: '#7c6ae0',
  },
  storiesCard: {
    backgroundColor: '#6e9bf0',
  },
  booksCard: {
    backgroundColor: '#10b981',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  brandName: {
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'PTSans_700Bold',
    color: '#4b3b86',
  },
  cardIcon: {
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: 'bold', fontFamily: 'PTSans_700Bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
  },
});
