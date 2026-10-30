import { StyleSheet, Text, View } from 'react-native';
import { px } from '../layout';

export type GlyphName = 'play' | 'search' | 'link' | 'close' | 'help' | 'eye' | 'server' | 'back';

/**
 * Small icons for the entry screens, drawn with views so they scale with px() and take the text colour.
 * Shapes follow docs/design/*-mockup.png loosely; there is no icon font on the device.
 */
export function Glyph({ name, color, size = 32 }: { name: GlyphName; color: string; size?: number }) {
  const s = px(size);
  const line = Math.max(2, px(size / 10));
  switch (name) {
    case 'play':
      return (
        <View
          style={{
            width: 0,
            height: 0,
            borderTopWidth: s / 2,
            borderBottomWidth: s / 2,
            borderLeftWidth: s * 0.85,
            borderTopColor: 'transparent',
            borderBottomColor: 'transparent',
            borderLeftColor: color,
          }}
        />
      );
    case 'search':
      return (
        <View style={{ width: s, height: s }}>
          <View style={{ width: s * 0.72, height: s * 0.72, borderRadius: s, borderWidth: line, borderColor: color }} />
          <View
            style={{
              position: 'absolute',
              right: 0,
              bottom: s * 0.08,
              width: s * 0.38,
              height: line,
              backgroundColor: color,
              transform: [{ rotate: '45deg' }],
            }}
          />
        </View>
      );
    case 'link':
      return (
        <View style={[styles.center, { width: s, height: s, transform: [{ rotate: '-45deg' }] }]}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: s * 0.55, height: s * 0.36, borderRadius: s, borderWidth: line, borderColor: color }} />
            <View style={{ width: s * 0.55, height: s * 0.36, borderRadius: s, borderWidth: line, borderColor: color, marginLeft: -s * 0.18 }} />
          </View>
        </View>
      );
    case 'close':
    case 'help':
    case 'back':
      return (
        <View style={[styles.center, { width: s, height: s, borderRadius: s, borderWidth: line, borderColor: color }]}>
          <Text style={{ color, fontSize: s * 0.6, lineHeight: s * 0.75, fontWeight: '700' }}>
            {name === 'close' ? '×' : name === 'help' ? '?' : '‹'}
          </Text>
        </View>
      );
    case 'eye':
      return (
        <View style={[styles.center, { width: s, height: s * 0.62, borderRadius: s, borderWidth: line, borderColor: color }]}>
          <View style={{ width: s * 0.28, height: s * 0.28, borderRadius: s, backgroundColor: color }} />
        </View>
      );
    case 'server':
      return (
        <View style={{ width: s, height: s }}>
          {[0, 1].map(i => (
            <View
              key={i}
              style={{
                flex: 1,
                marginVertical: s * 0.05,
                borderRadius: s * 0.12,
                borderWidth: line,
                borderColor: color,
                flexDirection: 'row',
                justifyContent: 'flex-end',
                alignItems: 'center',
                paddingRight: s * 0.1,
              }}>
              <View style={{ width: line * 1.5, height: line * 1.5, borderRadius: s, backgroundColor: color }} />
            </View>
          ))}
        </View>
      );
  }
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
