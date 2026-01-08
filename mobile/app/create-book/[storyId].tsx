import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApiClient } from '../../src/contexts/ApiClientContext';
import { useChild } from '../../src/contexts/ChildContext';

interface OutputType {
  id: string;
  name: string;
  childFacingLabel?: string;
  shortDescription?: string;
  imageUrl?: string;
  layoutHints?: { pageCount?: number };
}

interface ImageStyle {
  id: string;
  title: string;
  description?: string;
  stylePrompt: string;
  sampleImageUrl?: string;
  preferred?: boolean;
  ageFrom?: number | null;
  ageTo?: number | null;
}

type Step = 'output-type' | 'art-style';

export default function CreateBookScreen() {
  const router = useRouter();
  const { storyId } = useLocalSearchParams<{ storyId: string }>();
  const apiClient = useApiClient();
  const { childProfile } = useChild();

  const [step, setStep] = useState<Step>('output-type');
  const [outputTypes, setOutputTypes] = useState<OutputType[]>([]);
  const [imageStyles, setImageStyles] = useState<ImageStyle[]>([]);
  const [selectedOutputType, setSelectedOutputType] = useState<OutputType | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<ImageStyle | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [ot, is] = await Promise.all([
        apiClient.getOutputTypes(),
        apiClient.getImageStyles(),
      ]);
      // Filter to live output types only
      setOutputTypes(ot.filter((t: any) => t.status === 'live'));
      // Sort styles: preferred first, then alphabetically
      const sorted = [...is].sort((a: ImageStyle, b: ImageStyle) => {
        const aPreferred = a.preferred ? 1 : 0;
        const bPreferred = b.preferred ? 1 : 0;
        if (aPreferred !== bPreferred) return bPreferred - aPreferred;
        return (a.title || '').localeCompare(b.title || '');
      });
      // Filter by age if child has DOB
      const childAge = getChildAge();
      const filtered = sorted.filter((style) => isStyleAppropriateForAge(style, childAge));
      setImageStyles(filtered);
    } catch (e) {
      console.error('Error loading data:', e);
      Alert.alert('Error', 'Failed to load book options');
    } finally {
      setLoading(false);
    }
  };

  const getChildAge = (): number | null => {
    if (!childProfile?.dateOfBirth) return null;
    const dob = childProfile.dateOfBirth;
    let date: Date | null = null;
    if (typeof dob === 'object' && 'toDate' in dob) {
      date = (dob as any).toDate();
    } else {
      const parsed = new Date(dob as string);
      date = isNaN(parsed.getTime()) ? null : parsed;
    }
    if (!date) return null;
    const diff = Date.now() - date.getTime();
    if (diff <= 0) return null;
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
  };

  const isStyleAppropriateForAge = (style: ImageStyle, childAge: number | null): boolean => {
    if (childAge === null) return true;
    const minAge = style.ageFrom ?? 0;
    const maxAge = style.ageTo;
    if (childAge < minAge) return false;
    if (maxAge !== null && maxAge !== undefined && maxAge !== 0 && childAge > maxAge) return false;
    return true;
  };

  const handleSelectOutputType = (ot: OutputType) => {
    setSelectedOutputType(ot);
    setStep('art-style');
  };

  const handleSelectStyle = async (style: ImageStyle) => {
    if (!selectedOutputType || creating) return;

    setSelectedStyle(style);
    setCreating(true);

    try {
      // Create storybook via API
      const storybookId = await apiClient.createStorybook(
        storyId!,
        selectedOutputType.id,
        style.id,
        style.stylePrompt
      );

      // Navigate to generating screen
      router.replace(`/generating/${storyId}?storybookId=${storybookId}`);
    } catch (e: any) {
      console.error('Error creating storybook:', e);
      Alert.alert('Error', e.message || 'Failed to create your book');
      setCreating(false);
      setSelectedStyle(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F59E0B" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  // Output Type Selection Step
  if (step === 'output-type') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBackButton}>
            <Text style={styles.headerBackText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerStep}>Step 1 of 2</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          {/* Icon and Title */}
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>📚</Text>
          </View>
          <Text style={styles.title}>Choose Your Book Type</Text>
          <Text style={styles.subtitle}>How would you like your story to look?</Text>

          {/* Output Type Cards */}
          <View style={styles.cardsContainer}>
            {outputTypes.map((ot) => (
              <TouchableOpacity
                key={ot.id}
                style={styles.card}
                onPress={() => handleSelectOutputType(ot)}
                activeOpacity={0.8}
              >
                <Text style={styles.cardTitle}>{ot.childFacingLabel || ot.name}</Text>
                {ot.shortDescription && (
                  <Text style={styles.cardDescription}>{ot.shortDescription}</Text>
                )}
                {ot.layoutHints?.pageCount && (
                  <Text style={styles.cardHint}>About {ot.layoutHints.pageCount} pages</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>

          {outputTypes.length === 0 && (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No book types available right now.</Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Art Style Selection Step
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setStep('output-type')} style={styles.headerBackButton}>
          <Text style={styles.headerBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerStep}>Step 2 of 2</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {/* Icon and Title */}
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>🎨</Text>
        </View>
        <Text style={styles.title}>Pick Your Art Style</Text>
        <Text style={styles.subtitle}>Tap the picture you like best!</Text>

        {/* Style Grid */}
        <View style={styles.stylesGrid}>
          {imageStyles.map((style) => (
            <TouchableOpacity
              key={style.id}
              style={[
                styles.styleCard,
                selectedStyle?.id === style.id && styles.styleCardSelected,
                creating && selectedStyle?.id !== style.id && styles.styleCardDisabled,
              ]}
              onPress={() => handleSelectStyle(style)}
              activeOpacity={0.8}
              disabled={creating}
            >
              {/* Circular Image */}
              <View style={[
                styles.styleImageContainer,
                selectedStyle?.id === style.id && styles.styleImageContainerSelected,
              ]}>
                {style.sampleImageUrl ? (
                  <Image
                    source={{ uri: style.sampleImageUrl }}
                    style={styles.styleImage}
                  />
                ) : (
                  <View style={styles.styleImagePlaceholder}>
                    <Text style={styles.styleImagePlaceholderText}>🎨</Text>
                  </View>
                )}
                {/* Selection Indicator */}
                {selectedStyle?.id === style.id && (
                  <View style={styles.selectionOverlay}>
                    {creating ? (
                      <ActivityIndicator color="#FFFFFF" size="large" />
                    ) : (
                      <Text style={styles.checkmark}>✓</Text>
                    )}
                  </View>
                )}
              </View>
              {/* Style Name */}
              <Text style={styles.styleName}>{style.title}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {imageStyles.length === 0 && (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No art styles available right now.</Text>
          </View>
        )}
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
  headerStep: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    color: '#B45309',
  },
  headerSpacer: {
    width: 60,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  icon: {
    fontSize: 48,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#92400E',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#B45309',
    textAlign: 'center',
    marginBottom: 24,
  },
  cardsContainer: {
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: '#FDE68A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#374151',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  cardHint: {
    fontSize: 12,
    color: '#F59E0B',
    marginTop: 8,
  },
  stylesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  styleCard: {
    width: '47%',
    alignItems: 'center',
    marginBottom: 16,
  },
  styleCardSelected: {
    // No additional styling needed - container handles it
  },
  styleCardDisabled: {
    opacity: 0.5,
  },
  styleImageContainer: {
    width: 112,
    height: 112,
    borderRadius: 56,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#FDE68A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
    marginBottom: 8,
  },
  styleImageContainerSelected: {
    borderColor: '#F59E0B',
    borderWidth: 4,
  },
  styleImage: {
    width: '100%',
    height: '100%',
  },
  styleImagePlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#FDE68A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  styleImagePlaceholderText: {
    fontSize: 32,
  },
  selectionOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(245, 158, 11, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    fontSize: 48,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  styleName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    textAlign: 'center',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },
});
