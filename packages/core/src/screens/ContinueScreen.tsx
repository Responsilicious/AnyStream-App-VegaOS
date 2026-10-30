import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { FocusButton } from '../components/FocusButton';
import { WideCard } from '../components/WideCard';
import { selectContinuePlaying } from '../home';
import { px, useScale } from '../layout';
import { describeError } from '../providers/jellyfin';
import type { MediaItem, MediaProvider } from '../providers/types';
import type { HiddenContinueStore } from '../storage/hiddenStore';
import { colors, focus, type } from '../theme';
import { cardTitle, continueCaption, continueSubtitle } from '../util/format';

interface Props {
  provider: MediaProvider;
  hidden: HiddenContinueStore;
  /** A card was chosen: it opens the title page (docs/title-pages.md), it does not play. */
  onOpen: (item: MediaItem) => void;
  onBack: () => void;
}

const COLUMNS = 4;

/** View all for Continue Playing: every entry the rules keep, including the older ones Home leaves out. */
export function ContinueScreen({ provider, hidden, onOpen, onBack }: Props) {
  const s = useScale();
  const { width } = useWindowDimensions();
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  useEffect(() => {
    let cancelled = false;
    provider
      .getContinuePlaying()
      .then(found => {
        if (!cancelled) {
          const { row, more } = selectContinuePlaying(found, Date.now(), hidden.get());
          setItems([...row, ...more]);
        }
      })
      .catch(e => {
        if (!cancelled) {
          setError(describeError(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider, hidden]);

  const margin = s(96);
  const gap = s(24);
  const cardWidth = Math.floor((width - 2 * margin - (COLUMNS - 1) * gap) / COLUMNS) - 2 * focus.borderWidth;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingHorizontal: margin }]}>
        <Text style={styles.title}>Continue Playing</Text>
        <FocusButton label="Back" onPress={onBack} />
      </View>
      {error && (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      )}
      {!error && items === null && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      )}
      {!error && items !== null && items.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.empty}>Nothing to continue yet.</Text>
        </View>
      )}
      {!error && items !== null && items.length > 0 && (
        <FlatList
          data={items}
          key={`continue-${COLUMNS}`}
          numColumns={COLUMNS}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: margin, paddingTop: px(16), paddingBottom: s(120) }}
          columnWrapperStyle={{ marginBottom: gap }}
          renderItem={({ item, index }) => (
            <View style={{ marginRight: (index + 1) % COLUMNS === 0 ? 0 : gap }}>
              <WideCard
                title={cardTitle(item)}
                subtitle={continueSubtitle(item)}
                caption={continueCaption(item)}
                imageUrl={item.landscapeUrl}
                progress={item.runtimeMs ? item.resumeMs / item.runtimeMs : 0}
                width={cardWidth}
                preferred={index === 0}
                onPress={() => onOpen(item)}
              />
            </View>
          )}
          initialNumToRender={COLUMNS * 3}
          windowSize={5}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: px(32) },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: type.title, fontWeight: '800', flex: 1, marginRight: px(24) },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, fontSize: type.body, textAlign: 'center' },
  empty: { color: colors.textMuted, fontSize: type.body, textAlign: 'center' },
});
