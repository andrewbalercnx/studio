import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { useApiClient, kidSafeMessage, type BookReadView } from '../../src/contexts/ApiClientContext';
import { isBookInProgress, progressLabel } from '../../src/lib/books';

/** How often to check a Book that is still being made. */
const POLL_MS = 4000;

/**
 * One Book (GET /api/books/{id}). While the server is making it, shows what it
 * is doing (writing, drawing the characters, drawing page n of m) and checks
 * again every few seconds; once ready, a page-by-page reader with the page's
 * picture, words and narration. A partial Book reads with a placeholder where a
 * picture is missing.
 */
export default function BookScreen() {
  const router = useRouter();
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const apiClient = useApiClient();
  const { width } = useWindowDimensions();

  const [book, setBook] = useState<BookReadView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);

  const load = useCallback(async () => {
    if (!bookId) return;
    try {
      setBook(await apiClient.books.get(bookId));
      setError(null);
    } catch (e) {
      console.error('Error loading book:', e);
      setError(kidSafeMessage(e));
    }
  }, [apiClient, bookId]);

  useEffect(() => {
    load();
  }, [load]);

  // Keep checking while the server is still making the Book.
  useEffect(() => {
    if (!book || !isBookInProgress(book.status)) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [book, load]);

  const stopAudio = useCallback(async () => {
    const sound = soundRef.current;
    soundRef.current = null;
    setPlaying(false);
    if (sound) {
      try {
        await sound.unloadAsync();
      } catch {
        // already unloaded
      }
    }
  }, []);

  // Stop narration when the page changes or the screen closes.
  useEffect(() => {
    stopAudio();
  }, [pageIndex, stopAudio]);
  useEffect(() => () => void stopAudio(), [stopAudio]);

  const playNarration = async (url: string) => {
    if (playing) {
      await stopAudio();
      return;
    }
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri: url }, { shouldPlay: true });
      soundRef.current = sound;
      setPlaying(true);
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) stopAudio();
      });
    } catch (e) {
      console.error('Error playing narration:', e);
      setPlaying(false);
    }
  };

  if (!book) {
    return (
      <View style={styles.centered}>
        {error ? (
          <>
            <Text style={styles.bigIcon}>📚</Text>
            <Text style={styles.title}>{error}</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={load}>
              <Text style={styles.primaryButtonText}>Try again</Text>
            </TouchableOpacity>
          </>
        ) : (
          <ActivityIndicator size="large" color="#7c6ae0" />
        )}
      </View>
    );
  }

  const header = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {book.title || 'My Book'}
      </Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  if (book.status === 'failed') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <View style={styles.centered}>
          <Text style={styles.bigIcon}>😕</Text>
          <Text style={styles.title}>This book couldn&apos;t be finished</Text>
          <Text style={styles.subtitle}>Your story is safe. A grown-up can try making the book again.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (isBookInProgress(book.status) || !book.isReady) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {header}
        <View style={styles.centered}>
          <Text style={styles.bigIcon}>🎨</Text>
          <Text style={styles.title}>{progressLabel(book.progress)}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(4, Math.min(100, book.progress.percent))}%` }]} />
          </View>
          <Text style={styles.subtitle}>Your book is being made. It takes a couple of minutes, and you can come back later.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const pages = book.pages.filter((p) => p.inReader !== false);
  const page = pages[Math.min(pageIndex, pages.length - 1)];
  const imageSize = Math.min(width - 32, 520);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {header}
      <ScrollView contentContainerStyle={styles.readerContent}>
        {page?.artUrl ? (
          <Image source={{ uri: page.artUrl }} style={[styles.pageImage, { width: imageSize, height: imageSize }]} resizeMode="contain" />
        ) : (
          <View style={[styles.pageImage, styles.missingImage, { width: imageSize, height: imageSize }]}>
            <Text style={styles.bigIcon}>{page?.kind === 'story' ? '🖍️' : '📖'}</Text>
          </View>
        )}
        {page?.text ? <Text style={styles.pageText}>{page.text}</Text> : null}
        {page?.narrationUrl ? (
          <TouchableOpacity style={styles.secondaryButton} onPress={() => playNarration(page.narrationUrl!)}>
            <Text style={styles.secondaryButtonText}>{playing ? '⏹ Stop' : '🔊 Read to me'}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
      <View style={styles.pager}>
        <TouchableOpacity disabled={pageIndex === 0} onPress={() => setPageIndex((i) => Math.max(0, i - 1))} style={[styles.pagerButton, pageIndex === 0 && styles.pagerButtonDisabled]}>
          <Text style={styles.pagerButtonText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.pagerCount}>
          {pageIndex + 1} / {pages.length}
        </Text>
        <TouchableOpacity
          disabled={pageIndex >= pages.length - 1}
          onPress={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
          style={[styles.pagerButton, pageIndex >= pages.length - 1 && styles.pagerButtonDisabled]}
        >
          <Text style={styles.pagerButtonText}>Next ›</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f1fb' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, backgroundColor: '#f4f1fb' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#ede7fb',
  },
  backButton: { paddingVertical: 8, paddingRight: 16 },
  backText: { fontSize: 16, color: '#7c6ae0', fontWeight: '600', fontFamily: 'PTSans_700Bold' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: 'bold', fontFamily: 'PTSans_700Bold', color: '#4b3b86', textAlign: 'center' },
  headerSpacer: { width: 60 },
  bigIcon: { fontSize: 56, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: 'bold', fontFamily: 'PTSans_700Bold', color: '#4b3b86', textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 15, color: '#5b4ba0', textAlign: 'center', marginTop: 12, lineHeight: 21 },
  progressTrack: { width: '80%', height: 12, borderRadius: 6, backgroundColor: '#ede7fb', overflow: 'hidden' },
  progressFill: { height: 12, borderRadius: 6, backgroundColor: '#7c6ae0' },
  readerContent: { alignItems: 'center', padding: 16, paddingBottom: 24 },
  pageImage: { borderRadius: 16, backgroundColor: '#ffffff' },
  missingImage: { justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#ede7fb', borderStyle: 'dashed' },
  pageText: { fontSize: 20, lineHeight: 30, color: '#3a2e66', textAlign: 'center', marginTop: 20, paddingHorizontal: 8 },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#ede7fb',
  },
  pagerButton: { backgroundColor: '#7c6ae0', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  pagerButtonDisabled: { opacity: 0.35 },
  pagerButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600', fontFamily: 'PTSans_700Bold' },
  pagerCount: { fontSize: 16, color: '#4b3b86', fontWeight: '600', fontFamily: 'PTSans_700Bold' },
  primaryButton: { backgroundColor: '#7c6ae0', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12, marginTop: 8 },
  primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '600', fontFamily: 'PTSans_700Bold' },
  secondaryButton: { marginTop: 16, borderWidth: 2, borderColor: '#7c6ae0', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 12, backgroundColor: '#ffffff' },
  secondaryButtonText: { color: '#7c6ae0', fontSize: 16, fontWeight: '600', fontFamily: 'PTSans_700Bold' },
});
