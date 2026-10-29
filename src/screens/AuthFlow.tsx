import { useEffect, useState } from 'react';
import { initialStep, stepBack, type AuthStart, type AuthStep } from '../authFlow';
import { DEFAULT_SERVER_ADDRESS } from '../config';
import { JellyfinHttp, QuickConnectFlow, type DeviceInfo } from '../providers/jellyfin';
import type { Session } from '../providers/types';
import { ConnectServerScreen } from './ConnectServerScreen';
import { QuickConnectScreen } from './QuickConnectScreen';
import { SignInScreen } from './SignInScreen';
import { WelcomeScreen } from './WelcomeScreen';

interface Props {
  device: DeviceInfo;
  start?: AuthStart;
  onSignedIn: (session: Session) => void;
}

/** Runs the entry flow until someone is signed in; the library only appears after that. */
export function AuthFlow({ device, start, onSignedIn }: Props) {
  const [step, setStep] = useState<AuthStep>(() => initialStep(start));

  // Returning to sign-in on a known server (an expired sign-in): find out whether Quick Connect is on.
  const needsQuickCheck = step.name === 'signin' && step.quickConnect === undefined ? step.server : null;
  useEffect(() => {
    if (!needsQuickCheck) {
      return undefined;
    }
    const controller = new AbortController();
    new QuickConnectFlow(new JellyfinHttp(needsQuickCheck.baseUrl, device), needsQuickCheck)
      .isAvailable(controller.signal)
      .then(
        quick => setStep(s => (s.name === 'signin' && s.server.id === needsQuickCheck.id ? { ...s, quickConnect: quick } : s)),
        () => undefined,
      );
    return () => controller.abort();
  }, [needsQuickCheck, device]);

  const back = () => {
    const prev = stepBack(step);
    if (prev) {
      setStep(prev);
    }
  };

  switch (step.name) {
    case 'welcome':
      return <WelcomeScreen onConnect={() => setStep({ name: 'connect' })} />;
    case 'connect':
      return (
        <ConnectServerScreen
          device={device}
          initialAddress={step.address ?? DEFAULT_SERVER_ADDRESS}
          onConnected={(server, quickConnect) => setStep({ name: 'signin', server, quickConnect })}
          onBack={back}
        />
      );
    case 'signin':
      return (
        <SignInScreen
          device={device}
          server={step.server}
          quickConnect={step.quickConnect === true}
          initialUserName={step.userName}
          notice={step.notice}
          onSignedIn={onSignedIn}
          onQuickConnect={() => setStep({ name: 'quickconnect', server: step.server, userName: step.userName })}
          onChangeServer={() => setStep({ name: 'connect', address: step.server.baseUrl })}
          onBack={back}
        />
      );
    case 'quickconnect':
      return (
        <QuickConnectScreen
          device={device}
          server={step.server}
          onSignedIn={onSignedIn}
          onUsePassword={back}
          onCancel={back}
        />
      );
  }
}
