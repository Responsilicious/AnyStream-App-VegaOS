import { App as CoreApp, setPlatform } from '@anystream/core';
import { fireosPlatform } from './platform';

// Register the device layer first, then render the shared app.
setPlatform(fireosPlatform);

export const App = CoreApp;
export default App;
