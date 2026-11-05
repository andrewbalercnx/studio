import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useChild } from '../../src/contexts/ChildContext';
import {
  useApiClient,
  newIdempotencyKey,
  kidSafeMessage,
  type FormOption,
  type StyleOption,
} from '../../src/contexts/ApiClientContext';

/** Age in whole years from a date of birth string (null = unknown). */
function ageFromDateOfBirth(dob?: string): number | null {
  if (!dob) return null;
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return null;
  const diff = Date.now() - date.getTime();
  if (diff <= 0) return null;
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

/** Whether a Style suits a child of this age (unknown age: every Style). */
function styleSuitsAge(style: StyleOption, age: number | null): boolean {
  if (age === null) return true;
  if (age < (style.ageFrom ?? 0)) return false;
  if (style.ageTo && age > style.ageTo) return false;
  return true;
}

/**
 * Turn a finished Story into a picture book (ADR-0011): the child picks a Form
 * (what kind of book) then a Style (how it looks). Choosing a Style creates the
 * Book with POST /api/books — length and density default from the Form on the
 * server — and opens the Book view, which watches it being made.
 */
export default function CreateBookScreen() {
  const router = useRouter();
  const { storyId } = useLocalSearchParams<{ storyId: string }>();
  const apiClient = useApiClient();
  const { childProfile } = useChild();
  const childAge = ageFromDateOfBirth(childProfile?.dateOfBirth);

  const [forms, setForms] = useState<FormOption[]>([]);
  const [styles_, setStyles] = useState<StyleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormOption | null>(null);
  const [chosenStyleId, setChosenStyleId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const [formList, styleList] = await Promise.all([apiClient.catalog.outputTypes(), apiClient.catalog.imageStyles()]);
      setForms(formList);
      setStyles(styleList);
    } catch (e) {
      console.error('Error loading book choices:', e);
      setLoadError("We couldn't load the book choices.");
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const suitableStyles = styles_.filter((style) => styleSuitsAge(style, childAge));

  const chooseStyle = async (style: StyleOption) => {
    if (!form || !storyId || creating) return;
    setChosenStyleId(style.id);
    setCreating(true);
    setCreateError(null);
    try {
      const result = await apiClient.books.create({
        storyId,
        formId: form.id,
        styleId: style.id,
        idempotencyKey: newIdempotencyKey(),
      });
      router.replace(`/book/${result.bookId}`);
    } catch (e) {
      console.error('Error creating book:', e);
      setCreateError(kidSafeMessage(e));
      setChosenStyleId(null);
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F59E0B" />
        <Text style={styles.loadingText}>Loading book choices...</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>📚</Text>
        <Text style={styles.errorTitle}>{loadError}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={loadCatalog}>
          <Text style={styles.primaryButtonText}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Step 1: choose the Form.
  if (!form) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Step 1 of 2</Text>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          <Text style={styles.bigIcon}>📘</Text>
          <Text style={styles.title}>Choose Your Book Type</Text>
          <Text style={styles.subtitle}>How would you like your story to look?</Text>
          {forms.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>No book types available right now.</Text>
            </View>
          ) : (
            forms.map((option) => (
              <TouchableOpacity key={option.id} style={styles.formCard} onPress={() => setForm(option)}>
                <Text style={styles.formTitle}>{option.childFacingLabel || option.name}</Text>
                {option.shortDescription ? <Text style={styles.formDescription}>{option.shortDescription}</Text> : null}
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Step 2: choose the Style (tapping one creates the Book).
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => !creating && setForm(null)} style={styles.backButton} disabled={creating}>
          <Text style={[styles.backText, creating && styles.disabledText]}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Step 2 of 2</Text>
        <View style={styles.headerSpacer} />
      </View>
      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        <Text style={styles.bigIcon}>🎨</Text>
        <Text style={styles.title}>Pick Your Art Style</Text>
        <Text style={styles.subtitle}>Tap the picture you like best!</Text>
        {createError ? <Text style={styles.createError}>{createError}</Text> : null}
        <View style={styles.styleGrid}>
          {suitableStyles.map((style) => {
            const chosen = chosenStyleId === style.id;
            return (
              <TouchableOpacity
                key={style.id}
                style={[styles.styleItem, creating && !chosen && styles.dimmed]}
                onPress={() => chooseStyle(style)}
                disabled={creating}
              >
                <View style={[styles.styleThumb, chosen && styles.styleThumbChosen]}>
                  {style.sampleImageUrl ? (
                    <Image source={{ uri: style.sampleImageUrl }} style={styles.styleImage} />
                  ) : (
                    <View style={styles.styleImagePlaceholder}>
                      <Text style={styles.styleImagePlaceholderIcon}>🎨</Text>
                    </View>
                  )}
                  {chosen ? (
                    <View style={styles.styleOverlay}>
                      {creating ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.styleCheck}>✓</Text>}
                    </View>
                  ) : null}
                </View>
                <Text style={styles.styleTitle}>{style.title}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {suitableStyles.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No art styles available right now.</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FEF3C7' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FEF3C7' },
  loadingText: { marginTop: 16, fontSize: 16, color: '#B45309' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FEF3C7', padding: 40 },
  errorIcon: { fontSize: 64, marginBottom: 16 },
  errorTitle: { fontSize: 18, fontWeight: '600', color: '#374151', marginBottom: 24, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
  },
  backButton: { paddingVertical: 8, paddingRight: 16 },
  backText: { fontSize: 16, color: '#F59E0B', fontWeight: '600' },
  disabledText: { color: '#D1D5DB' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '600', color: '#92400E' },
  headerSpacer: { width: 60 },
  content: { flex: 1 },
  contentContainer: { padding: 20, paddingBottom: 40 },
  bigIcon: { fontSize: 48, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#92400E', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#B45309', textAlign: 'center', marginBottom: 20 },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#FDE68A',
    padding: 18,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  formTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  formDescription: { fontSize: 14, color: '#6B7280', marginTop: 4 },
  styleGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  styleItem: { width: '47%', alignItems: 'center', marginBottom: 20 },
  dimmed: { opacity: 0.5 },
  styleThumb: {
    width: 120,
    height: 120,
    borderRadius: 60,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#FDE68A',
    backgroundColor: '#FFFFFF',
  },
  styleThumbChosen: { borderColor: '#F59E0B' },
  styleImage: { width: '100%', height: '100%' },
  styleImagePlaceholder: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: '#FEF3C7' },
  styleImagePlaceholderIcon: { fontSize: 36 },
  styleOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(245, 158, 11, 0.4)', justifyContent: 'center', alignItems: 'center' },
  styleCheck: { fontSize: 44, color: '#FFFFFF', fontWeight: 'bold' },
  styleTitle: { fontSize: 15, fontWeight: '600', color: '#1F2937', textAlign: 'center', marginTop: 8 },
  createError: { fontSize: 15, color: '#B45309', textAlign: 'center', marginBottom: 16 },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 24, alignItems: 'center', marginTop: 12 },
  emptyText: { fontSize: 15, color: '#6B7280' },
  primaryButton: { backgroundColor: '#F59E0B', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
});
