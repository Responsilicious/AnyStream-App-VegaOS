import { StyleSheet, Text, View } from 'react-native';
import { px } from '../layout';
import type { CardBadge } from '../search/sources';
import { badgeBackground, colors, providerColors, type } from '../theme';

/**
 * The chip over a search card's artwork (search mockup, 30 Oct 2026): a small mark for the kind of server and
 * its name, or stacked layers and "On 3 servers". Marks are plain shapes in each provider's colour, drawn with
 * views like Glyph, not the providers' logos.
 */
export function SourceBadge({ badge }: { badge: CardBadge }) {
  return (
    <View style={styles.badge}>
      <Mark kind={badge.kind} />
      <Text style={styles.label} numberOfLines={1}>
        {badge.label}
        {badge.current ? <Text style={styles.current}>{'  ·  Current'}</Text> : null}
      </Text>
    </View>
  );
}

const SIZE = 26;

function Mark({ kind }: { kind: CardBadge['kind'] }) {
  const s = px(SIZE);
  const line = Math.max(2, px(3));
  const color = providerColors[kind];
  switch (kind) {
    case 'many':
      // Three stacked layers.
      return (
        <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
          {[0, 1, 2].map(i => (
            <View
              key={i}
              style={{
                position: 'absolute',
                top: s * (0.12 + i * 0.2),
                width: s * 0.62,
                height: s * 0.62,
                borderWidth: line,
                borderColor: color,
                backgroundColor: i === 0 ? color : badgeBackground,
                transform: [{ scaleY: 0.5 }, { rotate: '45deg' }],
              }}
            />
          ))}
        </View>
      );
    case 'plex':
      return (
        <View style={[styles.center, { width: s, height: s }]}>
          <Text style={{ color, fontSize: s * 1.1, lineHeight: s * 1.15, fontWeight: '900' }}>›</Text>
        </View>
      );
    case 'jellyfin':
      return (
        <View style={[styles.center, { width: s, height: s }]}>
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: s * 0.5,
              borderRightWidth: s * 0.5,
              borderBottomWidth: s * 0.85,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
            }}
          />
        </View>
      );
    case 'emby':
      return (
        <View style={[styles.center, { width: s, height: s }]}>
          <View style={{ width: s * 0.72, height: s * 0.72, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
          <View
            style={{
              position: 'absolute',
              width: 0,
              height: 0,
              marginLeft: s * 0.08,
              borderTopWidth: s * 0.18,
              borderBottomWidth: s * 0.18,
              borderLeftWidth: s * 0.28,
              borderTopColor: 'transparent',
              borderBottomColor: 'transparent',
              borderLeftColor: colors.text,
            }}
          />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    left: px(14),
    bottom: px(14),
    maxWidth: '88%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: px(14),
    paddingVertical: px(8),
    borderRadius: px(10),
    backgroundColor: badgeBackground,
  },
  label: { color: colors.text, fontSize: type.caption, fontWeight: '600', marginLeft: px(10), flexShrink: 1 },
  current: { color: colors.accent },
  center: { alignItems: 'center', justifyContent: 'center' },
});
