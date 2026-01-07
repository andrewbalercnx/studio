import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import { useChild } from '../src/contexts/ChildContext';

export default function Index() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { childId, loading: childLoading } = useChild();

  useEffect(() => {
    if (authLoading || childLoading) return;

    if (!user) {
      // Not logged in, go to login
      router.replace('/login');
    } else if (!childId) {
      // Logged in but no child selected, go to child selection
      router.replace('/select-child');
    } else {
      // Logged in with child selected, go to home
      router.replace('/home');
    }
  }, [user, childId, authLoading, childLoading, router]);

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Text style={styles.logo}>📚</Text>
        <Text style={styles.title}>StoryPic Kids</Text>
      </View>
      <ActivityIndicator size="large" color="#F59E0B" />
      <Text style={styles.loadingText}>Loading...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    padding: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 80,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#92400E',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#B45309',
  },
});
