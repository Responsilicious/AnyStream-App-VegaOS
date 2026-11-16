import { App, setPlatform } from '@anystream/core';
import { AppRegistry } from 'react-native';
import { installHistoryBack } from './platform/back';
import { webPlatform } from './platform';
import { installKeyboard } from './platform/keys';
import { fitStage } from './platform/stage';

// Register the device layer first, then render the shared app into the scaled 1920 × 1080 stage.
setPlatform(webPlatform);
installKeyboard();
installHistoryBack();

const stage = document.getElementById('stage');
if (!stage) {
  throw new Error('AnyStream: index.html has no #stage element');
}
fitStage(stage);

AppRegistry.registerComponent('AnyStream', () => App);
(AppRegistry as unknown as { runApplication(name: string, options: { rootTag: HTMLElement }): void }).runApplication('AnyStream', {
  rootTag: stage,
});
