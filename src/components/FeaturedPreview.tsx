import { Image, StyleSheet, Text, View } from 'react-native';
import { px, useScale } from '../layout';
import type { MediaItem } from '../providers/types';
import { colors, type } from '../theme';
import { cardTitle, episodeLabel, formatMeta } from '../util/format';
import { formatClock } from '../util/ticks';
import { FocusButton } from './FocusButton';

interface Props {
  item?: MediaItem;
  onPlay: (item: MediaItem) => void;
  onDetails: (item: MediaItem) => void;
  /** Opens the card menu: the reliable way to reach it without a long press. */
  onMore: (item: MediaItem) => void;
}

/**
 * The preview beside the focused title: information and two actions on the left, a 640 × 360 still on the
 * right (docs/design.md section 3). It is a still, never video, and it never starts playback by itself.
 */
export function FeaturedPreview({ item, onPlay, onDetails, onMore }: Props) {
  const s = useScale();
  const canResume = !!item && item.resumeMs > 0 && !item.played;

  return (
    <View style={[styles.row, { paddingHorizontal: s(96), height: s(360) + s(24) }]}>
      <View style={styles.info}>
        {item ? (
          <>
            <Text style={styles.title} numberOfLines={2}>
              {cardTitle(item)}
            </Text>
            {item.kind === 'episode' ? (
              <Text style={styles.episode} numberOfLines={1}>
                {[episodeLabel(item), item.title].filter(Boolean).join('  ·  ')}
              </Text>
            ) : null}
            <Text style={styles.meta} numberOfLines={1}>
              {formatMeta(item)}
            </Text>
            {item.overview ? (
              <Text style={styles.overview} numberOfLines={3}>
                {item.overview}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <FocusButton
                label={canResume ? `Resume from ${formatClock(item.resumeMs)}` : 'Play'}
                primary
                onPress={() => onPlay(item)}
                style={styles.action}
              />
              <FocusButton label="Details" onPress={() => onDetails(item)} style={styles.action} />
              <FocusButton label="More" onPress={() => onMore(item)} style={styles.action} />
            </View>
          </>
        ) : null}
      </View>
      <View style={[styles.imageBox, { width: s(640), height: s(360) }]}>
        {item?.landscapeUrl ? (
          // Keyed by nothing on purpose: the old picture stays until the new one has loaded, so it never flashes.
          <Image source={{ uri: item.landscapeUrl }} style={{ width: s(640), height: s(360) }} resizeMode="cover" />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  info: { flex: 1, paddingRight: px(48), justifyContent: 'center' },
  title: { color: colors.text, fontSize: type.featured, fontWeight: '800' },
  episode: { color: colors.text, fontSize: type.body, marginTop: px(6) },
  meta: { color: colors.textMuted, fontSize: type.body, marginTop: px(8) },
  overview: { color: colors.text, fontSize: type.body, lineHeight: type.body * 1.4, marginTop: px(14) },
  actions: { flexDirection: 'row', marginTop: px(22) },
  action: { marginRight: px(16) },
  imageBox: { borderRadius: px(12), overflow: 'hidden', backgroundColor: colors.surface },
});
