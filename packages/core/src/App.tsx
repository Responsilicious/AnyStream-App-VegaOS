import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Image, StyleSheet, View } from 'react-native';
import { EXPIRED_NOTICE, type AuthStart } from './authFlow';
import { APP_VERSION, DEVICE_NAME, STORE_BUILD } from './config';
import { describeWindow } from './layout';
import { DEFAULT_CAPABILITIES } from './player/capabilities';
import { createProvider } from './providers/create';
import { originOf } from './providers/plex/http';
import type { DeviceInfo } from './providers/jellyfin';
import { ConnectionStore } from './connections/connectionStore';
import { ContextCoordinator, type SwitchPhase } from './connections/contextCoordinator';
import type { ConnectionStatus, ConnectionView } from './connections/model';
import { checkConnection } from './connections/status';
import { statusText } from './servers';
import {
  activeSection,
  backLabel,
  currentRoute,
  goBack,
  goToSection,
  HOME,
  openContinue,
  openGenre,
  openItem,
  playItem,
  selectSection,
  type RouteStack,
  type Section,
} from './navigation';
import { isJellyfinFamily, type DeviceCapabilities, type MediaItem, type ServerKind, type ServerRecord, type Session, type StartChoice } from './providers/types';
import { AddServerFlow } from './screens/AddServerFlow';
import { AuthFlow } from './screens/AuthFlow';
import { ContinueScreen } from './screens/ContinueScreen';
import { GenreScreen } from './screens/GenreScreen';
import { MainScreen } from './screens/MainScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { ServerUnavailableScreen } from './screens/ServerUnavailableScreen';
import { MoviePage } from './screens/MoviePage';
import { ProfilePickerScreen } from './screens/ProfilePickerScreen';
import { QuickSwitcher } from './screens/QuickSwitcher';
import { ServerManagerScreen } from './screens/ServerManagerScreen';
import { SeriesPage } from './screens/SeriesPage';
import { platform } from './platform';
import { HiddenContinueStore } from './storage/hiddenStore';
import { LibraryPrefsStore } from './library/prefsStore';
import type { BrowseMemory } from './screens/BrowseScreen';
import { SessionStore } from './storage/sessionStore';
import { colors } from './theme';
import { px } from './layout';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO = require('./assets/logo.png');

if (STORE_BUILD) {
  // Store builds keep errors only. The diagnostic lines elsewhere help on test devices but can record LAN
  // addresses and track names, which do not belong in a shipped app's logs.
  const quiet = () => undefined;
  console.log = quiet;
  console.info = quiet;
  console.debug = quiet;
  console.warn = quiet;
}

/** Longest we hold the splash waiting for the device codec probe. */
const PROBE_BUDGET_MS = 2500;

/** Server screens that sit over the library: quick switcher, Settings → Servers, Add server. */
type Panel =
  | { name: 'switcher' }
  | { name: 'manager' }
  | { name: 'add'; start?: { provider: ServerKind; server?: ServerRecord; userName?: string } }
  | { name: 'profiles' };

class SwitchRefused extends Error {
  constructor(readonly status: ConnectionStatus) {
    super(status);
  }
}

export const App = () => {
  const kv = useMemo(() => platform().createKeyValueStore(), []);
  // SessionStore keeps the install id; servers and sign-ins live in ConnectionStore (src/connections/).
  const store = useMemo(() => new SessionStore(kv), [kv]);
  const connections = useMemo(() => new ConnectionStore(kv), [kv]);
  const libraryPrefs = useMemo(() => new LibraryPrefsStore(kv), [kv]);
  const device = useMemo<DeviceInfo>(
    () => ({ id: store.getDeviceId(), name: DEVICE_NAME, version: APP_VERSION }),
    [store],
  );

  const [caps, setCaps] = useState<DeviceCapabilities | null>(null);
  // The connection being shown. At launch: the startup choice (pinned, else last used), checked below.
  const [activeId, setActiveId] = useState<string | undefined>(() => connections.startupConnection()?.connection.id);
  const [session, setSession] = useState<Session | undefined>(() => (activeId ? connections.toSession(activeId) : undefined));
  const [panel, setPanel] = useState<Panel | undefined>(undefined);
  const [switchPhase, setSwitchPhase] = useState<SwitchPhase>('idle');
  const [switchTarget, setSwitchTarget] = useState<string | undefined>(undefined);
  const [switchError, setSwitchError] = useState<string | undefined>(undefined);
  // Focus goes back to the header's server pill after the switcher closes.
  const [pillFocus, setPillFocus] = useState(false);
  const [stack, setStack] = useState<RouteStack>(HOME);
  // Start-up check of a saved sign-in (docs/sign-in.md): Home if it works, sign-in again if it expired,
  // Retry / Change server if the server does not answer. Runs alongside the codec probe, so it adds no wait.
  const [startup, setStartup] = useState<'checking' | 'retrying' | 'ok' | 'unavailable'>(() => (session ? 'checking' : 'ok'));
  // Set when the entry flow must show although a session exists (Change server), or with a server to sign in to.
  const [authStart, setAuthStart] = useState<AuthStart | undefined>(undefined);
  // The Home card that had focus, kept across screens so Back lands the user where they were.
  const homeFocus = useRef<string | undefined>(undefined);
  // Movies and Series results and focus, so Back from a title page lands where the user was. Scoped by server,
  // viewer and library inside, and dropped whenever the server, profile or section changes.
  const browseMovies = useRef<BrowseMemory | undefined>(undefined);
  const browseSeries = useRef<BrowseMemory | undefined>(undefined);
  const browseMemory = useMemo(() => ({ movies: browseMovies, series: browseSeries }), []);
  const forgetBrowse = useCallback(() => {
    browseMovies.current = undefined;
    browseSeries.current = undefined;
  }, []);

  useEffect(() => {
    // The first thing to look at when sizes seem wrong: what the platform says the window is.
    console.log(`AnyStream layout: ${describeWindow()}`);
  }, []);

  useEffect(() => {
    let done = false;
    const finish = (value: DeviceCapabilities) => {
      if (!done) {
        done = true;
        setCaps(value);
      }
    };
    const timer = setTimeout(() => finish(DEFAULT_CAPABILITIES), PROBE_BUDGET_MS);
    platform().probeDeviceCapabilities().then(finish, () => finish(DEFAULT_CAPABILITIES));
    return () => {
      done = true;
      clearTimeout(timer);
    };
  }, []);

  // The start-up check now covers Jellyfin and Plex alike, and never falls back to another server silently:
  // unavailable offers Retry and Change server, expired goes back to that server's sign-in.
  const verify = useCallback(
    (id: string, signal?: AbortSignal) => {
      checkConnection(connections, id, device, signal).then(
        result => {
          const view = connections.get(id);
          if (result.status === 'online') {
            if (result.workingEndpoint && view) {
              connections.updateEndpoints(view.server.id, [result.workingEndpoint, ...view.server.endpoints]);
              setSession(connections.toSession(id));
            }
            connections.activate(id);
            setStartup('ok');
          } else if (result.status === 'auth-required' && view) {
            connections.markAuthExpired(view.account.id);
            if (view.server.provider === 'emby') {
              // Emby signs in again through its own screens, on the same server and user.
              setPanel({ name: 'add', start: { provider: 'emby', server: serverRecord(view), userName: view.connection.profileName } });
            } else if (isJellyfinFamily(view.server.provider)) {
              store.forgetSignIn(view.server.nativeId);
              setAuthStart({ server: serverRecord(view), userName: view.connection.profileName, notice: EXPIRED_NOTICE });
            } else {
              setPanel({ name: 'add', start: { provider: 'plex' } });
            }
            setSession(undefined);
            setStartup('ok');
          } else {
            setStartup('unavailable');
          }
        },
        () => undefined, // cancelled: the app is closing
      );
    },
    [connections, device, store],
  );

  useEffect(() => {
    const id = connections.startupConnection()?.connection.id;
    if (!id || !connections.toSession(id)) {
      return undefined;
    }
    const controller = new AbortController();
    verify(id, controller.signal);
    return () => controller.abort();
  }, [connections, verify]);

  const provider = useMemo(() => (session && caps ? createProvider(session, device, caps) : null), [session, caps, device]);

  useEffect(() => {
    if (session) {
      // Which server and address the library comes from; the first thing to check when one fails to load.
      const account = activeId ? connections.get(activeId)?.account : undefined;
      console.log(
        `AnyStream active server: ${session.server.kind} ${originOf(session.server.baseUrl)}` +
          (account?.tokenKind ? ` (account sign-in: ${account.tokenKind})` : ''),
      );
    }
  }, [session, activeId, connections]);

  /** Shows a connection that is already validated: its own Home, nothing carried over from the last one. */
  const show = useCallback(
    (id: string | undefined) => {
      setActiveId(id);
      setSession(id ? connections.toSession(id) : undefined);
      setStack(HOME);
      homeFocus.current = undefined;
      forgetBrowse();
      setStartup('ok');
    },
    [connections, forgetBrowse],
  );

  /**
   * Opens a connection with nothing else on screen to fall back to (first server added, or picked after the
   * active one was removed). It goes through the start-up check, so a server that does not answer gets Retry /
   * Change server instead of an empty Home.
   */
  const openChecked = useCallback(
    (id: string) => {
      show(id);
      setStartup('checking');
      verify(id);
    },
    [show, verify],
  );

  // Switching (spec §11): the current server stays on screen until the new one has answered, accepted its
  // sign-in and listed its libraries. A failure leaves everything as it was. The player has no header, so a
  // switch cannot start mid-playback.
  const coordinator = useMemo(
    () =>
      new ContextCoordinator<Session>({
        check: async (id, signal) => {
          const result = await checkConnection(connections, id, device, signal);
          if (result.status !== 'online') {
            throw new SwitchRefused(result.status);
          }
        },
        prepare: async id => {
          const next = connections.toSession(id);
          if (!next) {
            throw new SwitchRefused('auth-required');
          }
          await createProvider(next, device, caps ?? DEFAULT_CAPABILITIES).getLibraries();
          return next;
        },
        commit: id => connections.activate(id),
      }),
    [connections, device, caps],
  );

  useEffect(
    () =>
      coordinator.subscribe(({ phase, target }) => {
        setSwitchPhase(phase);
        setSwitchTarget(target);
      }),
    [coordinator],
  );

  const switchTo = useCallback(
    async (id: string) => {
      setSwitchError(undefined);
      setPanel({ name: 'switcher' });
      const result = await coordinator.switchTo(id);
      if (result.outcome === 'switched') {
        show(id);
        setPanel(undefined);
        setPillFocus(true);
      } else if (result.outcome === 'failed') {
        const name = connections.get(id)?.displayName ?? 'That server';
        const status = result.error instanceof SwitchRefused ? result.error.status : 'unavailable';
        setSwitchError(`${name}: ${statusText(status)}. You're still on your current server.`);
      }
    },
    [coordinator, connections, show],
  );

  const closePanel = useCallback(() => {
    coordinator.cancel();
    setSwitchError(undefined);
    setPanel(undefined);
    setPillFocus(true);
  }, [coordinator]);

  const handleSignedIn = useCallback(
    (next: Session) => {
      const view = connections.addJellyfin(
        {
          provider: next.server.kind === 'emby' ? 'emby' : 'jellyfin',
          serverNativeId: next.server.id,
          serverName: next.server.name,
          baseUrl: next.server.baseUrl,
          userId: next.userId,
          userName: next.userName,
          accessToken: next.accessToken,
        },
        { activate: true },
      );
      setAuthStart(undefined);
      show(view.connection.id);
    },
    [connections, show],
  );

  const handleSignOut = useCallback(() => {
    if (activeId) {
      connections.remove(activeId);
    }
    show(undefined);
  }, [activeId, connections, show]);

  const open = useCallback((item: MediaItem) => setStack(s => openItem(s, item)), []);
  const play = useCallback((item: MediaItem, choice?: StartChoice) => setStack(s => playItem(s, item, choice)), []);
  const back = useCallback(() => setStack(s => goBack(s)), []);
  const hidden = useMemo(
    () => (session ? new HiddenContinueStore(kv, `${session.server.id}.${session.userId}`) : null),
    [kv, session],
  );
  const viewAllContinue = useCallback(() => setStack(s => openContinue(s)), []);
  const genre = useCallback((name: string) => setStack(s => openGenre(s, name)), []);
  const rememberHomeFocus = useCallback((key: string) => {
    homeFocus.current = key;
  }, []);
  // A top bar choice is a fresh visit: saved filters and sort still apply, but results reload from the server.
  const select = useCallback(
    (section: Section) => {
      forgetBrowse();
      setStack(s => selectSection(s, section));
    },
    [forgetBrowse],
  );
  // From a title page the top bar leaves the pages and goes to a section.
  const goSection = useCallback(
    (section: Section) => {
      forgetBrowse();
      setStack(goToSection(section));
    },
    [forgetBrowse],
  );

  if (!caps || startup === 'checking') {
    return (
      <View style={styles.splash}>
        <Image source={LOGO} accessibilityLabel="AnyStream" style={styles.splashLogo} resizeMode="contain" />
      </View>
    );
  }

  const hasConnections = connections.list().length > 0;

  if (panel?.name === 'add' || (!hasConnections && !authStart)) {
    const firstRun = !session;
    return (
      <AddServerFlow
        store={connections}
        device={device}
        firstRun={firstRun}
        start={panel?.name === 'add' ? panel.start : undefined}
        onDone={(_added, open) => {
          setPanel(undefined);
          if (open && firstRun) {
            openChecked(open);
          } else if (open) {
            switchTo(open);
          }
        }}
        onCancel={() => setPanel(hasConnections ? { name: 'manager' } : undefined)}
        onManage={() => setPanel({ name: 'manager' })}
      />
    );
  }

  const manager = (
    <ServerManagerScreen
      store={connections}
      device={device}
      onSwitch={id => {
        if (session) {
          switchTo(id);
        } else {
          setPanel(undefined);
          openChecked(id);
        }
      }}
      onAddServer={() => setPanel({ name: 'add' })}
      onSignInAgain={view => {
        if (view.server.provider === 'emby') {
          setPanel({ name: 'add', start: { provider: 'emby', server: serverRecord(view), userName: view.connection.profileName } });
        } else if (isJellyfinFamily(view.server.provider)) {
          setPanel(undefined);
          setAuthStart({ server: serverRecord(view), userName: view.connection.profileName, notice: EXPIRED_NOTICE });
        } else {
          setPanel({ name: 'add', start: { provider: 'plex' } });
        }
      }}
      onActiveRemoved={() => show(undefined)}
      onBack={() => (session ? closePanel() : BackHandler.exitApp())}
    />
  );

  if (panel?.name === 'manager' && !authStart) {
    return manager;
  }

  if (session && !authStart && panel?.name !== 'switcher' && (startup === 'unavailable' || startup === 'retrying')) {
    return (
      <ServerUnavailableScreen
        server={session.server}
        checking={startup === 'retrying'}
        onRetry={() => {
          setStartup('retrying');
          if (activeId) {
            verify(activeId);
          }
        }}
        // With other servers saved: Switch server (the quick switcher) and Manage servers, never a silent switch.
        // With none, Change server connects a new Jellyfin server as before.
        onChangeServer={() =>
          connections.list().length > 1 ? setPanel({ name: 'switcher' }) : setAuthStart({ connect: true, server: session.server })
        }
        onManageServers={connections.list().length > 1 ? () => setPanel({ name: 'manager' }) : undefined}
      />
    );
  }

  if (authStart) {
    return <AuthFlow device={device} start={authStart} onSignedIn={handleSignedIn} />;
  }

  // Servers are saved but none is chosen (the active one was removed): show the list, never a silent pick.
  if (!session) {
    return manager;
  }

  if (panel?.name === 'switcher') {
    return (
      <QuickSwitcher
        store={connections}
        device={device}
        phase={switchPhase}
        target={switchTarget}
        error={switchError}
        onSwitch={switchTo}
        onClose={closePanel}
        onAddServer={() => setPanel({ name: 'add' })}
        onManage={() => setPanel({ name: 'manager' })}
      />
    );
  }

  const activeView = activeId ? connections.get(activeId) : undefined;
  if (panel?.name === 'profiles' && activeView && activeId) {
    return (
      <ProfilePickerScreen
        store={connections}
        device={device}
        view={activeView}
        onSwitched={() => {
          setPanel(undefined);
          openChecked(activeId);
        }}
        onCancel={() => setPanel(undefined)}
      />
    );
  }

  if (!provider || !hidden) {
    return null;
  }

  const serverName = (activeId && connections.get(activeId)?.displayName) || session.server.name;
  const openSwitcher = () => {
    setPillFocus(false);
    setPanel({ name: 'switcher' });
  };

  const route = currentRoute(stack);
  switch (route.name) {
    case 'player':
      return <PlayerScreen provider={provider} item={route.item} choice={route.choice} onExit={back} />;
    case 'detail':
      return (
        <MoviePage
          provider={provider}
          item={route.item}
          nav={{ active: activeSection(stack), profileName: provider.session.userName, backLabel: backLabel(stack), onSection: goSection }}
          onPlay={play}
          onOpen={open}
          onBack={back}
        />
      );
    case 'series':
      return (
        <SeriesPage
          provider={provider}
          series={route.item}
          entryEpisodeId={route.episodeId}
          nav={{ active: activeSection(stack), profileName: provider.session.userName, backLabel: backLabel(stack), onSection: goSection }}
          onPlay={play}
          onBack={back}
        />
      );
    case 'genre':
      return <GenreScreen provider={provider} genre={route.genre} onOpen={open} onBack={back} />;
    case 'continue':
      return <ContinueScreen provider={provider} hidden={hidden} onOpen={open} onBack={back} />;
    default:
      return (
        <MainScreen
          provider={provider}
          section={route.section}
          onSection={select}
          onOpen={open}
          onPlay={play}
          onGenre={genre}
          onSignOut={handleSignOut}
          hidden={hidden}
          onViewAllContinue={viewAllContinue}
          homeFocusKey={homeFocus.current}
          onHomeFocus={rememberHomeFocus}
          serverName={serverName}
          onServer={openSwitcher}
          serverPreferred={pillFocus}
          onSwitchProfile={session.server.kind === 'plex' ? () => setPanel({ name: 'profiles' }) : undefined}
          libraryPrefs={libraryPrefs}
          browseMemory={browseMemory}
        />
      );
  }
};

export default App;

/** The provider-facing record for a saved connection, for screens that still take a ServerRecord. */
function serverRecord(view: ConnectionView): ServerRecord {
  return { id: view.server.nativeId, kind: view.server.provider, name: view.displayName, baseUrl: view.server.endpoints[0] ?? '' };
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  splashLogo: { width: px(720), height: px(240) },
});
