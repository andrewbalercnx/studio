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
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useChild } from '../src/contexts/ChildContext';
import { useApiClient } from '../src/contexts/ApiClientContext';

interface StoryGenerator {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  flowType: string;
  isEnabled?: boolean;
}

export default function CreateScreen() {
  const router = useRouter();
  const { childId, childProfile } = useChild();
  const apiClient = useApiClient();

  const [generators, setGenerators] = useState<StoryGenerator[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    loadGenerators();
  }, []);

  const loadGenerators = async () => {
    try {
      const data = await apiClient.getGenerators();
      // Filter to enabled generators
      const enabled = data.filter((g: StoryGenerator) => g.isEnabled !== false);
      setGenerators(enabled);
    } catch (e) {
      console.error('Error loading generators:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectGenerator = async (generator: StoryGenerator) => {
    if (!childId) return;

    setCreating(generator.id);
    try {
      const session = await apiClient.createSession(childId, generator.id);
      // Navigate to the play page with the session
      router.push(`/play/${session.id}?generator=${generator.flowType}`);
    } catch (e: any) {
      console.error('Error creating session:', e);
      alert(e.message || 'Failed to start story');
    } finally {
      setCreating(null);
    }
  };

  const getGeneratorIcon = (flowType: string) => {
    switch (flowType) {
      case 'wizard':
        return '🧙';
      case 'gemini3':
      case 'gemini4':
        return '🌟';
      case 'friends':
        return '👫';
      default:
        return '✨';
    }
  };

  const getGeneratorColor = (flowType: string) => {
    switch (flowType) {
      case 'wizard':
        return '#8B5CF6';
      case 'gemini3':
        return '#F59E0B';
      case 'gemini4':
        return '#EF4444';
      case 'friends':
        return '#10B981';
      default:
        return '#6366F1';
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F59E0B" />
        <Text style={styles.loadingText}>Loading story options...</Text>
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
        <Text style={styles.headerTitle}>Create a Story</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Child Info */}
      <View style={styles.childInfo}>
        {childProfile?.avatarUrl ? (
          <Image source={{ uri: childProfile.avatarUrl }} style={styles.childAvatar} />
        ) : (
          <View style={styles.childAvatarPlaceholder}>
            <Text style={styles.childAvatarInitial}>
              {childProfile?.displayName?.charAt(0)?.toUpperCase() || '?'}
            </Text>
          </View>
        )}
        <Text style={styles.childName}>
          {childProfile?.displayName}'s new story
        </Text>
      </View>

      {/* Generator Options */}
      <Text style={styles.sectionTitle}>Choose how to create your story:</Text>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.generatorGrid}>
        {generators.map((generator) => {
          const color = getGeneratorColor(generator.flowType);
          const icon = getGeneratorIcon(generator.flowType);
          const isCreating = creating === generator.id;

          return (
            <TouchableOpacity
              key={generator.id}
              style={[styles.generatorCard, { borderColor: color }]}
              onPress={() => handleSelectGenerator(generator)}
              disabled={creating !== null}
            >
              {isCreating ? (
                <ActivityIndicator size="large" color={color} style={styles.generatorIcon} />
              ) : generator.imageUrl ? (
                <Image source={{ uri: generator.imageUrl }} style={styles.generatorImage} />
              ) : (
                <Text style={[styles.generatorIcon, { color }]}>{icon}</Text>
              )}
              <Text style={styles.generatorName}>{generator.name}</Text>
              {generator.description && (
                <Text style={styles.generatorDescription} numberOfLines={2}>
                  {generator.description}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
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
  childInfo: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
  },
  childAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 12,
    borderWidth: 3,
    borderColor: '#FDE68A',
  },
  childAvatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#FDE68A',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  childAvatarInitial: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#92400E',
  },
  childName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#92400E',
  },
  sectionTitle: {
    fontSize: 16,
    color: '#6B7280',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  scrollView: {
    flex: 1,
  },
  generatorGrid: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  generatorCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
    borderWidth: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  generatorImage: {
    width: 80,
    height: 80,
    borderRadius: 12,
    marginBottom: 12,
  },
  generatorIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  generatorName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
    textAlign: 'center',
  },
  generatorDescription: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});
