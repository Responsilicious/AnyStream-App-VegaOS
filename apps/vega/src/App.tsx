import { App as CoreApp, setPlatform } from '@anystream/core';
import { vegaPlatform } from './platform';

// The generated Vega project's index.js registers this component. Register the device layer first, then
// render the shared app.
setPlatform(vegaPlatform);

export const App = CoreApp;
export default App;
