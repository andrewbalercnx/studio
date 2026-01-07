import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  Image,
  FlatList,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import { useApiClient } from '../../src/contexts/ApiClientContext';

interface StorybookPage {
  id: string;
  pageNumber: number;
  displayText?: string;
  bodyText?: string;
  imageUrl?: string;
  audioUrl?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function BookReaderScreen() {
  const router = useRouter();
  const { storyId, storybookId } = useLocalSearchParams<{ storyId: string; storybookId?: string }>();
  const apiClient = useApiClient();
  const flatListRef = useRef<FlatList>(null);

  const [pages, setPages] = useState<StorybookPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);

  // Refs to access current state in callbacks
  const currentPageRef = useRef(currentPage);
  const pagesRef = useRef(pages);
  const autoPlayRef = useRef(autoPlay);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    autoPlayRef.current = autoPlay;
  }, [autoPlay]);

  useEffect(() => {
    loadPages();
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [storyId, storybookId]);

  const loadPages = async () => {
    if (!storyId) return;
    try {
      let pagesData: StorybookPage[] = [];

      if (storybookId) {
        // Load from storybooks subcollection
        pagesData = await apiClient.getStorybookPages(storyId, storybookId);
      } else {
        // Legacy: load from stories/[storyId]/pages
        // For now, just show error - we need storybookId
        setLoading(false);
        return;
      }

      // Sort by page number
      pagesData.sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
      setPages(pagesData);
    } catch (e) {
      console.error('Error loading pages:', e);
    } finally {
      setLoading(false);
    }
  };

  // Play audio for a specific page index
  const playPageAudio = useCallback(async (pageIndex: number) => {
    const page = pagesRef.current[pageIndex];
    if (!page?.audioUrl) return;

    try {
      // Stop and unload previous sound
      if (sound) {
        await sound.unloadAsync();
        setSound(null);
      }

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: page.audioUrl },
        { shouldPlay: true },
        (status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
            // Auto-advance to next page if autoPlay is enabled
            if (autoPlayRef.current) {
              const nextPageIndex = currentPageRef.current + 1;
              if (nextPageIndex < pagesRef.current.length) {
                // Advance to next page and play its audio
                setCurrentPage(nextPageIndex);
                flatListRef.current?.scrollToIndex({ index: nextPageIndex, animated: true });
                // Play next page audio after a short delay
                setTimeout(() => {
                  playPageAudio(nextPageIndex);
                }, 500);
              } else {
                // Reached end of book, disable autoPlay
                setAutoPlay(false);
              }
            }
          }
        }
      );
      setSound(newSound);
      setIsPlaying(true);
    } catch (e) {
      console.error('Error playing audio:', e);
    }
  }, [sound]);

  const handlePlayAudio = async () => {
    const page = pages[currentPage];
    if (!page?.audioUrl) return;

    if (isPlaying && sound) {
      await sound.pauseAsync();
      setIsPlaying(false);
      setAutoPlay(false); // Stop auto-play if user pauses
      return;
    }

    // Enable auto-play when user starts playing
    setAutoPlay(true);
    playPageAudio(currentPage);
  };

  const goToPage = (index: number) => {
    if (index < 0 || index >= pages.length) return;

    // Stop audio and auto-play when manually changing pages
    if (sound) {
      sound.stopAsync();
      setIsPlaying(false);
    }
    setAutoPlay(false);

    setCurrentPage(index);
    flatListRef.current?.scrollToIndex({ index, animated: true });
  };

  const renderPage = ({ item, index }: { item: StorybookPage; index: number }) => {
    const text = item.displayText || item.bodyText || '';

    return (
      <View style={styles.pageContainer}>
        {/* Image */}
        {item.imageUrl && (
          <View style={styles.imageContainer}>
            <Image
              source={{ uri: item.imageUrl }}
              style={styles.pageImage}
              resizeMode="contain"
            />
          </View>
        )}

        {/* Text */}
        <View style={styles.textContainer}>
          <Text style={styles.pageText}>{text}</Text>
        </View>

        {/* Page Number */}
        <Text style={styles.pageNumber}>
          Page {index + 1} of {pages.length}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F59E0B" />
        <Text style={styles.loadingText}>Loading book...</Text>
      </View>
    );
  }

  if (pages.length === 0) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorIcon}>📚</Text>
        <Text style={styles.errorTitle}>No pages found</Text>
        <Text style={styles.errorSubtitle}>
          This book doesn't have any pages yet.
        </Text>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentPageData = pages[currentPage];
  const hasAudio = !!currentPageData?.audioUrl;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBackButton}>
          <Text style={styles.headerBackText}>← Back</Text>
        </TouchableOpacity>

        {/* Audio Button */}
        {hasAudio && (
          <TouchableOpacity
            style={[styles.audioButton, isPlaying && styles.audioButtonPlaying]}
            onPress={handlePlayAudio}
          >
            <Text style={styles.audioButtonText}>
              {isPlaying ? '⏸️' : '🔊'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Page Content */}
      <FlatList
        ref={flatListRef}
        data={pages}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.id}
        renderItem={renderPage}
        onMomentumScrollEnd={(e) => {
          const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
          if (index !== currentPage) {
            setCurrentPage(index);
            if (sound) {
              sound.stopAsync();
              setIsPlaying(false);
            }
            setAutoPlay(false); // Stop auto-play when user swipes
          }
        }}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />

      {/* Navigation */}
      <View style={styles.navigation}>
        <TouchableOpacity
          style={[styles.navButton, currentPage === 0 && styles.navButtonDisabled]}
          onPress={() => goToPage(currentPage - 1)}
          disabled={currentPage === 0}
        >
          <Text style={[styles.navButtonText, currentPage === 0 && styles.navButtonTextDisabled]}>
            ← Previous
          </Text>
        </TouchableOpacity>

        <View style={styles.pageIndicator}>
          {pages.map((_, index) => (
            <TouchableOpacity
              key={index}
              style={[styles.dot, currentPage === index && styles.dotActive]}
              onPress={() => goToPage(index)}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[styles.navButton, currentPage === pages.length - 1 && styles.navButtonDisabled]}
          onPress={() => goToPage(currentPage + 1)}
          disabled={currentPage === pages.length - 1}
        >
          <Text style={[styles.navButtonText, currentPage === pages.length - 1 && styles.navButtonTextDisabled]}>
            Next →
          </Text>
        </TouchableOpacity>
      </View>
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
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    padding: 40,
  },
  errorIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
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
  audioButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#8B5CF6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  audioButtonPlaying: {
    backgroundColor: '#8B5CF6',
    borderColor: '#8B5CF6',
  },
  audioButtonText: {
    fontSize: 20,
  },
  pageContainer: {
    width: SCREEN_WIDTH,
    flex: 1,
    padding: 16,
  },
  imageContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  pageImage: {
    width: '100%',
    height: '100%',
  },
  textContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  pageText: {
    fontSize: 18,
    lineHeight: 26,
    color: '#374151',
    textAlign: 'center',
  },
  pageNumber: {
    textAlign: 'center',
    marginTop: 12,
    fontSize: 14,
    color: '#9CA3AF',
  },
  navigation: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#FDE68A',
  },
  navButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  navButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F59E0B',
  },
  navButtonTextDisabled: {
    color: '#9CA3AF',
  },
  pageIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#D1D5DB',
  },
  dotActive: {
    backgroundColor: '#F59E0B',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
});
