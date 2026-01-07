import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useChild } from '../src/contexts/ChildContext';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const router = useRouter();
  const { childProfile, clearChild } = useChild();

  const handleSwitchChild = async () => {
    await clearChild();
    router.replace('/select-child');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.avatarButton} onPress={handleSwitchChild}>
          {childProfile?.avatarUrl ? (
            <Image source={{ uri: childProfile.avatarUrl }} style={styles.avatar} />
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
          <Text style={styles.cardIcon}>✨</Text>
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
          <Text style={styles.cardIcon}>📖</Text>
          <Text style={styles.cardTitle}>My Stories</Text>
          <Text style={styles.cardDescription}>
            Read your amazing stories!
          </Text>
        </TouchableOpacity>

        {/* My Books Card */}
        <TouchableOpacity
          style={[styles.card, styles.booksCard]}
          onPress={() => router.push('/books')}
        >
          <Text style={styles.cardIcon}>📚</Text>
          <Text style={styles.cardTitle}>My Books</Text>
          <Text style={styles.cardDescription}>
            View your picture books!
          </Text>
        </TouchableOpacity>
      </ScrollView>
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
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
  },
  avatarButton: {
    marginRight: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    borderColor: '#FDE68A',
  },
  avatarPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FDE68A',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#F59E0B',
  },
  avatarInitial: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#92400E',
  },
  headerText: {
    flex: 1,
  },
  greeting: {
    fontSize: 16,
    color: '#92400E',
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#92400E',
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
    backgroundColor: '#F59E0B',
  },
  storiesCard: {
    backgroundColor: '#8B5CF6',
  },
  booksCard: {
    backgroundColor: '#10B981',
  },
  cardIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
  },
});
