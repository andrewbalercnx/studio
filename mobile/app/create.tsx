import { useState, useEffect, useRef } from 'react';
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
import {
  useApiClient,
  kidSafeMessage,
  newIdempotencyKey,
  type CreationMode,
  type CreationModeId,
} from '../src/contexts/ApiClientContext';

/**
 * Choose how to make a story. The list comes from GET /api/creation-modes;
 * a tap starts the Story with POST /api/stories (one idempotency key per
 * mode, so a double tap or a retry starts one Story) and opens the play screen.
 */
export default function CreateScreen() {
  const router = useRouter();
  const { childId, childProfile } = useChild();
  const apiClient = useApiClient();

  const [modes, setModes] = useState<CreationMode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<CreationModeId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());

  useEffect(() => {
    loadModes();
  }, []);

  const loadModes = async () => {
    setLoading(true);
    try {
      setModes(await apiClient.listCreationModes());
      setError(null);
    } catch (e) {
      console.error('Error loading modes:', e);
      setError(kidSafeMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectMode = async (mode: CreationMode) => {
    if (!childId || creating) return;
    const keyName = `${childId}|${mode.modeId}`;
    const idempotencyKey = keys.current.get(keyName) ?? newIdempotencyKey();
    keys.current.set(keyName, idempotencyKey);

    setCreating(mode.modeId);
    setError(null);
    try {
      const result = await apiClient.createStory({ childId, modeId: mode.modeId, idempotencyKey });
      router.push(`/play/${result.storyId}`);
    } catch (e) {
      console.error('Error starting story:', e);
      setError(kidSafeMessage(e));
    } finally {
      setCreating(null);
    }
  };

  const getModeIcon = (modeId: CreationModeId) => {
    switch (modeId) {
      case 'wizard':
        return '🧙';
      case 'freeplay':
      case 'guided':
        return '🌟';
      case 'friends':
        return '👫';
      case 'adventure':
        return '🧭';
      default:
        return '✨';
    }
  };

  const getModeColor = (modeId: CreationModeId) => {
    switch (modeId) {
      case 'wizard':
        return '#8B5CF6';
      case 'freeplay':
        return '#F59E0B';
      case 'guided':
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

      {/* Mode Options */}
      <Text style={styles.sectionTitle}>How do you want to create your story?</Text>
      {error && <Text style={styles.errorText}>{error}</Text>}

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.generatorGrid}>
        {modes.length === 0 && !error && (
          <Text style={styles.generatorDescription}>No story adventures available right now. Please ask a grown-up to check the settings.</Text>
        )}
        {modes.map((mode) => {
          const color = getModeColor(mode.modeId);
          const icon = getModeIcon(mode.modeId);
          const isCreating = creating === mode.modeId;

          return (
            <TouchableOpacity
              key={mode.modeId}
              style={[styles.generatorCard, { borderColor: color }]}
              onPress={() => handleSelectMode(mode)}
              disabled={creating !== null}
            >
              {isCreating ? (
                <ActivityIndicator size="large" color={color} style={styles.generatorIcon} />
              ) : (
                <Text style={[styles.generatorIcon, { color }]}>{icon}</Text>
              )}
              {mode.recommended && <Text style={styles.recommended}>⭐ Recommended for first-timers</Text>}
              <Text style={styles.generatorName}>{mode.name}</Text>
              {!!mode.description && (
                <Text style={styles.generatorDescription} numberOfLines={3}>
                  {mode.description}
                </Text>
              )}
              {isCreating && !!mode.loadingMessage && <Text style={styles.generatorDescription}>{mode.loadingMessage}</Text>}
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
  recommended: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 6,
  },
  errorText: {
    fontSize: 15,
    color: '#B45309',
    paddingHorizontal: 20,
    marginBottom: 12,
    textAlign: 'center',
  },
  generatorDescription: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
  },
});
