module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Reanimated 4's worklets plugin; it must stay the last entry.
  plugins: ['react-native-worklets/plugin'],
};
