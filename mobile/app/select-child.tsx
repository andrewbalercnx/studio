import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import { useChild } from '../src/contexts/ChildContext';

export default function SelectChildScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const { children, loading, setChild, childId } = useChild();
  const [selecting, setSelecting] = useState<string | null>(null);

  const handleSelectChild = async (selectedChildId: string) => {
    setSelecting(selectedChildId);
    try {
      await setChild(selectedChildId);
      router.replace('/home');
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to select child');
    } finally {
      setSelecting(null);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/login');
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F59E0B" />
        <Text style={styles.loadingText}>Loading your children...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Who's Reading Today?</Text>
        <Text style={styles.subtitle}>Select a child to continue</Text>
      </View>

      {/* Children Grid */}
      {children.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>👶</Text>
          <Text style={styles.emptyText}>No children found</Text>
          <Text style={styles.emptySubtext}>
            Please add children in the parent app first.
          </Text>
        </View>
      ) : (
        <FlatList
          data={children}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[
                styles.childCard,
                childId === item.id && styles.childCardSelected,
              ]}
              onPress={() => handleSelectChild(item.id)}
              disabled={selecting !== null}
            >
              {selecting === item.id ? (
                <View style={styles.avatarPlaceholder}>
                  <ActivityIndicator color="#F59E0B" />
                </View>
              ) : item.avatarUrl ? (
                <Image
                  source={{ uri: item.avatarUrl }}
                  style={styles.avatar}
                />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Text style={styles.avatarInitial}>
                    {item.displayName?.charAt(0)?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <Text style={styles.childName} numberOfLines={1}>
                {item.displayName}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Sign Out Button */}
      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FEF3C7',
    paddingTop: 60,
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
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#92400E',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#B45309',
    textAlign: 'center',
    marginTop: 8,
  },
  grid: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  gridRow: {
    justifyContent: 'space-evenly',
  },
  childCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    width: '45%',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  childCardSelected: {
    borderColor: '#F59E0B',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 12,
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FDE68A',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarInitial: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#92400E',
  },
  childName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
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
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
  signOutButton: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#FDE68A',
  },
  signOutText: {
    fontSize: 16,
    color: '#DC2626',
  },
});
