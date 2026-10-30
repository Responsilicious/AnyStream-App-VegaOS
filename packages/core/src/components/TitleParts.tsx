import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { px, useScale } from '../layout';
import type { MediaVersion } from '../providers/types';
import { colors, focus, type } from '../theme';
import { FocusButton } from './FocusButton';

/** "‹  Back to Series": the link above every title page. */
export function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.back, focused && styles.backFocused]}>
      <Text style={styles.backText}>{`‹  ${label}`}</Text>
    </Pressable>
  );
}

/** A thin progress bar. `progress` is 0 to 1; 0 draws nothing. */
export function ProgressBar({ progress, width }: { progress: number; width?: number }) {
  if (progress <= 0) {
    return null;
  }
  return (
    <View style={[styles.track, width ? { width } : styles.trackFlex]}>
      <View style={[styles.fill, { width: `${Math.round(Math.min(1, progress) * 100)}%` }]} />
    </View>
  );
}

/**
 * The contained 16:9 preview on the right of a title page: a still, never video. Without a picture it shows
 * a plain surface, and the title stays on the left, so nothing is mislabelled.
 */
export function PreviewImage({ uri }: { uri?: string }) {
  const s = useScale();
  const width = s(640);
  const height = s(360);
  return (
    <View style={[styles.preview, { width, height }]}>
      {uri ? <Image source={{ uri }} style={{ width, height }} resizeMode="cover" /> : null}
    </View>
  );
}

/** A label and its value on one line, such as "Director  Maya Chen". */
export function FactRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue} numberOfLines={2}>
        {children}
      </Text>
    </View>
  );
}

/** "4K  HDR  5.1": quality marks of the chosen version. Draws nothing when there are none. */
export function QualityBadges({ badges }: { badges: string[] | undefined }) {
  if (!badges || badges.length === 0) {
    return null;
  }
  return (
    <View style={styles.badges}>
      {badges.map(badge => (
        <Text key={badge} style={styles.badge}>
          {badge}
        </Text>
      ))}
    </View>
  );
}

/** "Version  ✓ 2160p  1080p": one button per version, shown only when there is more than one. */
export function VersionPicker({
  versions,
  selectedId,
  onChoose,
}: {
  versions: MediaVersion[];
  selectedId: string | undefined;
  onChoose: (version: MediaVersion) => void;
}) {
  if (versions.length < 2) {
    return null;
  }
  return (
    <View style={styles.versions}>
      <Text style={styles.versionLabel}>Version</Text>
      {versions.map(v => (
        <FocusButton
          key={v.id}
          label={`${v.id === selectedId ? '✓  ' : ''}${v.name}`}
          onPress={() => onChoose(v)}
          style={styles.version}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', marginTop: px(10) },
  badge: {
    color: colors.text,
    fontSize: type.caption,
    fontWeight: '800',
    borderWidth: px(2),
    borderColor: colors.textMuted,
    borderRadius: px(6),
    paddingHorizontal: px(10),
    paddingVertical: px(2),
    marginRight: px(10),
  },
  versions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: px(8) },
  versionLabel: { color: colors.textMuted, fontSize: type.body, marginRight: px(16), marginBottom: px(8) },
  version: { marginRight: px(14), marginBottom: px(8) },
  back: {
    alignSelf: 'flex-start',
    paddingHorizontal: px(14),
    paddingVertical: px(6),
    borderRadius: px(10),
    borderWidth: focus.borderWidth,
    borderColor: 'transparent',
  },
  backFocused: { borderColor: colors.focusRing, backgroundColor: colors.surface },
  backText: { color: colors.textMuted, fontSize: type.body },
  track: { height: px(8), borderRadius: px(4), backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  trackFlex: { alignSelf: 'stretch' },
  fill: { height: px(8), backgroundColor: colors.accent },
  preview: { borderRadius: px(12), overflow: 'hidden', backgroundColor: colors.surface },
  fact: { flexDirection: 'row', marginTop: px(6) },
  factLabel: { color: colors.textMuted, fontSize: type.body, width: px(130) },
  factValue: { color: colors.text, fontSize: type.body, flex: 1 },
});
