import { useState } from 'react';
import { BackHandler, Image, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle } from '../components/AuthFrame';
import { px } from '../layout';
import { colors, type } from '../theme';
import { useBack } from '../useBack';

interface Props {
  onConnect: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ART = require('../assets/welcome-art.jpg');
/** The artwork, cut from docs/design/start-mockup.png, is 1010 × 700. */
const ART_WIDTH = 940;
const ART_HEIGHT = Math.round((ART_WIDTH * 700) / 1010);

/**
 * First launch (docs/design/start-mockup.png): artwork, a short explanation and one primary action. Help with
 * setup explains what is needed. No intro animation or artificial wait. Back leaves the app, except from Help.
 */
export function WelcomeScreen({ onConnect }: Props) {
  const [help, setHelp] = useState(false);
  const leave = () => {
    if (help) {
      setHelp(false);
    } else {
      BackHandler.exitApp();
    }
  };
  useBack(() => {
    if (help) {
      setHelp(false);
      return true;
    }
    return false;
  });

  const art = (
    <View>
      <Image
      source={ART}
      accessibilityIgnoresInvertColors
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{ width: px(ART_WIDTH), height: px(ART_HEIGHT) }}
      resizeMode="contain"
      />
      <Text style={styles.platform}>AnyStream for Vega OS</Text>
    </View>
  );

  return (
    <AuthFrame right={art} onBack={leave} backAtBottom>
      {help ? (
        <View>
          <HeroTitle>Setting up</HeroTitle>
          <Step n={1} text="You need a Jellyfin or Plex server that this TV can reach, and an account on it." />
          <Step n={2} text="Jellyfin: find its address under Dashboard, then Networking, for example https://media.example.com or 192.168.1.20:8096. Turn on Quick Connect for the easiest sign-in." />
          <Step n={3} text="Plex: no address needed. You link this TV to your Plex account with a code at plex.tv/link, then pick your servers." />
          <AuthButton label="Connect to server" icon="play" primary preferred onPress={onConnect} style={authStyles.stackGap} />
        </View>
      ) : (
        <View>
          <Text style={styles.title} accessibilityRole="header">
            {'Your library.\nReady to play.'}
          </Text>
          <Text style={styles.lead}>Connect to your Jellyfin or Plex server to get started.</Text>
          <AuthButton label="Connect to server" icon="play" primary preferred onPress={onConnect} style={authStyles.stackGap} />
          <AuthButton label="Help with setup" icon="help" onPress={() => setHelp(true)} />
          <Text style={authStyles.note}>An existing Jellyfin or Plex server and account are required.</Text>
        </View>
      )}
    </AuthFrame>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: px(92), lineHeight: px(100), fontWeight: '800', marginBottom: px(20) },
  lead: { color: colors.text, fontSize: type.card, marginBottom: px(40) },
  step: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: px(24) },
  stepNumber: {
    width: px(48),
    height: px(48),
    borderRadius: px(24),
    borderWidth: px(2),
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: px(20),
  },
  stepNumberText: { color: colors.text, fontSize: type.body, fontWeight: '800' },
  stepText: { flex: 1, color: colors.text, fontSize: type.body, lineHeight: px(34) },
  platform: { alignSelf: 'flex-end', marginTop: px(24), color: colors.textMuted, fontSize: type.caption },
});
