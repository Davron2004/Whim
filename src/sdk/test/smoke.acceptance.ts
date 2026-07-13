import { defineApp, type AppSpec } from '../index';

const SmokeScreen = (): null => null;
const spec: AppSpec = {
  name: 'SDK smoke',
  initial: 'Home',
  screens: { Home: SmokeScreen },
  capabilities: [],
};

if (defineApp(spec) !== spec) {
  throw new Error('defineApp must keep the app descriptor identity contract');
}
console.log('SDK acceptance smoke: PASS');
