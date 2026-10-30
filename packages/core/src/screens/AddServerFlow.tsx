import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '../components/AuthButton';
import { AuthFrame, authStyles, HeroTitle } from '../components/AuthFrame';
import { ServerRow } from '../components/ServerRow';
import type { ConnectionStore } from '../connections/connectionStore';
import type { ConnectionView } from '../connections/model';
import { plexSigner } from '../connections/plexKey';
import { DEFAULT_SERVER_ADDRESS, PLEX_JWT_SIGN_IN } from '../config';
import { px } from '../layout';
import { colors, type } from '../theme';
import type { DeviceInfo } from '../providers/jellyfin/http';
import { PLEX_CLIENTS_URL, PlexHttp } from '../providers/plex';
import type { ServerKind, ServerRecord, Session } from '../providers/types';
import { connectionSubtitle, providerName } from '../servers';
import { useBack } from '../useBack';
import { ConnectServerScreen } from './ConnectServerScreen';
import { EmbyUserPickerScreen } from './EmbyUserPickerScreen';
import { PlexLinkScreen } from './PlexLinkScreen';
import { PlexServerPickerScreen } from './PlexServerPickerScreen';
import { ProviderChooserScreen } from './ProviderChooserScreen';
import { QuickConnectScreen } from './QuickConnectScreen';
import { SignInScreen } from './SignInScreen';
import { WelcomeScreen } from './WelcomeScreen';

type Step =
  | { name: 'welcome' }
  | { name: 'choose' }
  | { name: 'jf-connect'; address?: string }
  | { name: 'jf-signin'; server: ServerRecord; quickConnect: boolean }
  | { name: 'jf-quick'; server: ServerRecord }
  | { name: 'emby-connect'; address?: string }
  | { name: 'emby-users'; server: ServerRecord; userId?: string }
  /** `listed`: the server shows a user list, so Choose another user goes back to it. */
  | { name: 'emby-signin'; server: ServerRecord; userName?: string; listed: boolean }
  | { name: 'plex-link' }
  | { name: 'plex-pick'; accountId: string; accountName: string; token: string }
  | { name: 'pick-first'; ids: string[] }
  | { name: 'saved'; ids: string[] };

interface Props {
  store: ConnectionStore;
  device: DeviceInfo;
  /** First launch: the first server added opens straight away. In-app: adding never switches. */
  firstRun: boolean;
  /** Start straight on one provider's setup, e.g. Sign in again on a saved Jellyfin server. */
  start?: { provider: ServerKind; server?: ServerRecord; userName?: string };
  /**
   * Saved. `open` is the connection to open now: on first launch always; in-app only if the user chose
   * Switch now, and the caller still validates it before switching.
   */
  onDone: (added: ConnectionView[], open?: string) => void;
  onCancel: () => void;
  /** Settings → Servers, offered beside the server already in use. */
  onManage?: () => void;
}

/**
 * Add server (spec §4–§8): choose Jellyfin, Emby or Plex, then that provider's own setup. Jellyfin reuses the
 * existing connect, sign-in and Quick Connect screens. Emby uses the same connect and sign-in screens in its own
 * words, with the server's user list between them (Emby connection spec EC02–EC05). Plex links the account,
 * then lets the user pick servers; if several are added on first launch, the user chooses which opens first.
 */
export function AddServerFlow({ store, device, firstRun, start, onDone, onCancel: cancelFlow, onManage }: Props) {
  const [step, setStep] = useState<Step>(() =>
    start?.provider === 'plex'
      ? { name: 'plex-link' }
      : start?.provider === 'jellyfin'
        ? start.server
          ? { name: 'jf-signin', server: start.server, quickConnect: false }
          : { name: 'jf-connect' }
        : start?.provider === 'emby'
          ? start.server
            ? { name: 'emby-signin', server: start.server, userName: start.userName, listed: false }
            : { name: 'emby-connect' }
        : firstRun
          ? { name: 'welcome' }
          : { name: 'choose' },
  );
  // One plex.tv client and one key for the whole flow, so re-renders never start a new PIN.
  const plex = useMemo(() => new PlexHttp(PLEX_CLIENTS_URL, device), [device]);
  const signer = useMemo(() => (PLEX_JWT_SIGN_IN ? plexSigner(store) : undefined), [store]);
  const plexAccount = useMemo(
    () => (step.name === 'plex-pick' ? plex.withToken(step.token) : undefined),
    // Only the token matters; the rest of the step is display text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plex, step.name === 'plex-pick' ? step.token : undefined],
  );

  // On first launch there is nothing behind this flow, so leaving it goes back to Welcome.
  const onCancel = () => (firstRun && !start ? setStep({ name: 'welcome' }) : cancelFlow());

  const finish = (added: ConnectionView[]) => {
    if (added.length === 0) {
      onDone(added);
    } else if (!firstRun) {
      setStep({ name: 'saved', ids: added.map(v => v.connection.id) });
    } else if (added.length === 1) {
      onDone(added, added[0].connection.id);
    } else {
      setStep({ name: 'pick-first', ids: added.map(v => v.connection.id) });
    }
  };

  const savedJellyfin = (session: Session) => {
    const view = store.addJellyfin(
      {
        provider: session.server.kind === 'emby' ? 'emby' : 'jellyfin',
        serverNativeId: session.server.id,
        serverName: session.server.name,
        baseUrl: session.server.baseUrl,
        userId: session.userId,
        userName: session.userName,
        accessToken: session.accessToken,
      },
      { activate: false },
    );
    finish([view]);
  };

  switch (step.name) {
    case 'welcome':
      return <WelcomeScreen onConnect={() => setStep({ name: 'choose' })} />;
    case 'choose':
      return (
        <ProviderChooserScreen
          active={firstRun ? undefined : store.getActive()}
          onManage={onManage}
          onChoose={p => setStep(p === 'plex' ? { name: 'plex-link' } : p === 'emby' ? { name: 'emby-connect' } : { name: 'jf-connect' })}
          onBack={() => (firstRun ? setStep({ name: 'welcome' }) : onCancel())}
        />
      );
    case 'jf-connect':
      return (
        <ConnectServerScreen
          device={device}
          initialAddress={step.address ?? (firstRun ? DEFAULT_SERVER_ADDRESS : '')}
          onConnected={(server, quickConnect) => setStep({ name: 'jf-signin', server, quickConnect })}
          onUseOtherProvider={(_, address) => setStep({ name: 'emby-connect', address })}
          onBack={() => (start ? onCancel() : setStep({ name: 'choose' }))}
        />
      );
    case 'emby-connect':
      return (
        <ConnectServerScreen
          key="emby"
          device={device}
          family="emby"
          initialAddress={step.address ?? ''}
          onConnected={server => setStep({ name: 'emby-users', server })}
          onUseOtherProvider={(_, address) => setStep({ name: 'jf-connect', address })}
          onChangeProvider={() => setStep({ name: 'choose' })}
          onBack={() => (start ? onCancel() : setStep({ name: 'choose' }))}
        />
      );
    case 'emby-users':
      return (
        <EmbyUserPickerScreen
          device={device}
          server={step.server}
          rememberedUserId={step.userId}
          onChoose={user => setStep({ name: 'emby-signin', server: step.server, userName: user?.name, listed: true })}
          onNoUsers={() => setStep({ name: 'emby-signin', server: step.server, listed: false })}
          onChangeServer={() => setStep({ name: 'emby-connect', address: step.server.baseUrl })}
          onBack={() => setStep({ name: 'emby-connect', address: step.server.baseUrl })}
        />
      );
    case 'emby-signin': {
      const toList = () => setStep({ name: 'emby-users', server: step.server });
      return (
        <SignInScreen
          key={`emby-${step.userName ?? ''}`}
          device={device}
          server={step.server}
          quickConnect={false}
          initialUserName={step.userName}
          onSignedIn={savedJellyfin}
          onQuickConnect={() => undefined}
          onChangeServer={() => setStep({ name: 'emby-connect', address: step.server.baseUrl })}
          onChooseUser={step.listed ? toList : undefined}
          onChangeProvider={start ? undefined : () => setStep({ name: 'choose' })}
          onBack={step.listed ? toList : () => (start ? onCancel() : setStep({ name: 'emby-connect', address: step.server.baseUrl }))}
        />
      );
    }
    case 'jf-signin':
      return (
        <SignInScreen
          device={device}
          server={step.server}
          quickConnect={step.quickConnect}
          onSignedIn={savedJellyfin}
          onQuickConnect={() => setStep({ name: 'jf-quick', server: step.server })}
          onChangeServer={() => setStep({ name: 'jf-connect', address: step.server.baseUrl })}
          onBack={() => setStep({ name: 'jf-connect', address: step.server.baseUrl })}
        />
      );
    case 'jf-quick':
      return (
        <QuickConnectScreen
          device={device}
          server={step.server}
          onSignedIn={savedJellyfin}
          onUsePassword={() => setStep({ name: 'jf-signin', server: step.server, quickConnect: true })}
          onCancel={() => setStep({ name: 'jf-signin', server: step.server, quickConnect: true })}
        />
      );
    case 'plex-link':
      return (
        <PlexLinkScreen
          plex={plex}
          signer={signer}
          onLinked={(user, result) => {
            const account = store.addPlexAccount({ userId: user.id, userName: user.name, token: result.token, tokenKind: result.tokenKind });
            setStep({ name: 'plex-pick', accountId: account.id, accountName: user.name, token: result.token });
          }}
          onCancel={onCancel}
          onChangeProvider={() => setStep({ name: 'choose' })}
        />
      );
    case 'plex-pick':
      return (
        <PlexServerPickerScreen
          account={plexAccount as PlexHttp}
          accountName={step.accountName}
          saved={store.savedPlexServerIds(step.accountId)}
          removed={store.preferences().removedPlexServers}
          firstRun={firstRun}
          onDiscovered={found => store.refreshPlexServers(step.accountId, found)}
          onSave={choices => finish(store.addPlexServers(step.accountId, choices))}
          onOtherAccount={() => setStep({ name: 'plex-link' })}
          onCancel={onCancel}
        />
      );
    case 'pick-first':
      return <PickFirst views={step.ids.map(id => store.get(id)).filter((v): v is ConnectionView => !!v)} onPick={id => onDone(step.ids.map(i => store.get(i) as ConnectionView), id)} />;
    case 'saved': {
      const views = step.ids.map(id => store.get(id)).filter((v): v is ConnectionView => !!v);
      const current = store.getActive();
      return (
        <Saved
          views={views}
          currentName={current && !step.ids.includes(current.connection.id) ? current.displayName : undefined}
          onSwitch={id => onDone(views, id)}
          onDone={() => onDone(views)}
        />
      );
    }
  }
}

/** Several servers were added on first launch: the user says which opens; we never just take the first. */
function PickFirst({ views, onPick }: { views: ConnectionView[]; onPick: (id: string) => void }) {
  useBack(() => true);
  return (
    <AuthFrame>
      <HeroTitle>Open which first?</HeroTitle>
      <Text style={authStyles.lead}>All of these are saved. You can switch between them any time from the top bar.</Text>
      <View style={styles.list}>
        {views.map((v, i) => (
          <ServerRow
            key={v.connection.id}
            title={v.displayName}
            subtitle={connectionSubtitle(v)}
            status="Saved"
            tone="ok"
            preferred={i === 0}
            accessibilityLabel={`Open ${v.displayName}`}
            onPress={() => onPick(v.connection.id)}
          />
        ))}
      </View>
    </AuthFrame>
  );
}

/**
 * Added in-app: the current server stays active unless the user picks one here (spec §2.5). One server gets
 * the Emby connection spec's EC08 layout: what was added, which server is still in use, Switch or Keep.
 */
function Saved({
  views,
  currentName,
  onSwitch,
  onDone,
}: {
  views: ConnectionView[];
  /** The server still in use, named so Keep current server says what it keeps. */
  currentName?: string;
  onSwitch: (id: string) => void;
  onDone: () => void;
}) {
  useBack(() => {
    onDone();
    return true;
  });
  if (views.length === 1) {
    const v = views[0];
    return (
      <AuthFrame onBack={onDone}>
        <HeroTitle>{`${providerName(v.server.provider)} server added`}</HeroTitle>
        <Text style={authStyles.lead}>{`${v.displayName} is ready to browse.`}</Text>
        <View style={styles.list}>
          <ServerRow
            title={v.displayName}
            subtitle={connectionSubtitle(v)}
            status="Connected"
            tone="ok"
            disabled
            accessibilityLabel={`${v.displayName}, ${connectionSubtitle(v)}, connected`}
            onPress={() => undefined}
          />
        </View>
        {currentName ? <Text style={styles.current}>{`Your current server is still ${currentName}.`}</Text> : null}
        <View style={styles.actions}>
          <AuthButton label={`Switch to ${v.displayName}`} icon="play" primary preferred onPress={() => onSwitch(v.connection.id)} style={styles.action} />
          <AuthButton label="Keep current server" icon="server" onPress={onDone} style={styles.action} />
        </View>
        <Text style={authStyles.note}>You can switch later from the server menu.</Text>
      </AuthFrame>
    );
  }
  return (
    <AuthFrame onBack={onDone}>
      <HeroTitle>{views.length > 1 ? 'Servers added' : 'Server added'}</HeroTitle>
      <Text style={authStyles.lead}>You're still watching from your current server. Select one to switch to it now.</Text>
      <View style={styles.list}>
        {views.map(v => (
          <ServerRow
            key={v.connection.id}
            title={v.displayName}
            subtitle={connectionSubtitle(v)}
            status="Switch now"
            tone="ok"
            accessibilityLabel={`Switch to ${v.displayName} now`}
            onPress={() => onSwitch(v.connection.id)}
          />
        ))}
      </View>
      <AuthButton label="Done" primary preferred onPress={onDone} />
    </AuthFrame>
  );
}

const styles = StyleSheet.create({
  list: { maxWidth: px(1200), marginBottom: px(12) },
  current: { color: colors.text, fontSize: type.card, marginBottom: px(24) },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
  action: { marginRight: px(24), marginBottom: px(18) },
});
